const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize, forbidden } = require('./family-access');

function createShoppingService(pool) {
  async function access(familyId, userId, roles, write, work) {
    return withTransaction(pool, async tx => {
      const family = (await tx.query(`SELECT id FROM families WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ' FOR SHARE'}`, [familyId])).rows[0];
      if (!family) throw forbidden();
      await authorize(tx, familyId, userId, roles);
      return work(tx);
    });
  }

  // Safe unit conversion: only same dimension with known factor
  function toBaseQuantity(quantity, unitCode, unitsMap) {
    if (quantity == null || !unitCode) return { quantity, unitCode, converted: false };
    const unit = unitsMap.get(unitCode);
    if (!unit || !unit.to_base_factor) return { quantity, unitCode, converted: false };
    return { quantity: quantity * unit.to_base_factor, unitCode: unit.dimension === 'MASS' ? 'g' : unit.dimension === 'VOLUME' ? 'ml' : unitCode, converted: true };
  }

  // Calculate required ingredients from meal items with canonical merge and safe unit conversion
  async function calculateMealIngredients(tx, mealId, dinersCount, unitsMap) {
    const items = (await tx.query(`
      SELECT mi.*, r.base_servings, r.name as recipe_name
      FROM meal_items mi JOIN recipes r ON r.id = mi.recipe_id
      WHERE mi.meal_id = $1`, [mealId])).rows;
    const ingredientMap = new Map();
    for (const item of items) {
      const ratio = item.servings / (item.base_servings || 2);
      const ingredients = (await tx.query(`
        SELECT ri.*, i.display_name as ingredient_name, i.canonical_code, i.default_unit_code
        FROM recipe_ingredients ri
        LEFT JOIN ingredients i ON i.id = ri.ingredient_id
        WHERE ri.recipe_id=$1 AND ri.required=true`, [item.recipe_id])).rows;
      for (const ing of ingredients) {
        // Convert to base unit for merging
        const rawQty = ing.quantity ? ing.quantity * ratio : null;
        const converted = toBaseQuantity(rawQty, ing.unit_code, unitsMap);
        // Key includes unit dimension so incompatible units stay as separate requirements
        const unitDim = converted.converted ? converted.unitCode : (ing.unit_code || 'text');
        const key = (ing.ingredient_id || ing.canonical_code || ing.display_name_override || 'unknown_' + ing.id) + '|' + unitDim;
        if (!ingredientMap.has(key)) {
          ingredientMap.set(key, {
            ingredient_id: ing.ingredient_id,
            canonical_code: ing.canonical_code,
            name: ing.ingredient_name || ing.display_name_override,
            unit_code: converted.converted ? converted.unitCode : ing.unit_code,
            quantity: 0,
            quantity_text: ing.quantity_text,
            needs_unit_confirmation: !converted.converted && !ing.unit_code && !!ing.quantity_text,
            unit_incompatible: false,
            sources: []
          });
        }
        const entry = ingredientMap.get(key);
        // Merge: same key means same unit dimension, safe to add
        if (converted.converted) {
          entry.quantity += converted.quantity;
        } else if (ing.unit_code) {
          entry.quantity += rawQty || 0;
        }
        entry.sources.push({ recipe_id: item.recipe_id, recipe_name: item.recipe_name, quantity: ing.quantity, quantity_text: ing.quantity_text, unit_code: ing.unit_code });
      }
    }
    return Array.from(ingredientMap.values());
  }

  // Deduct fridge inventory with unit-safe conversion
  async function deductFridge(tx, familyId, ingredients, unitsMap) {
    const fridge = (await tx.query(`
      SELECT fi.*, i.display_name as ingredient_name, i.canonical_code
      FROM fridge_items fi LEFT JOIN ingredients i ON i.id = fi.ingredient_id
      WHERE fi.family_id=$1`, [familyId])).rows;
    for (const ing of ingredients) {
      if (ing.quantity == null) { ing.missing_quantity = null; continue; }
      let remaining = ing.quantity;
      const matching = fridge.filter(f =>
        (f.ingredient_id && f.ingredient_id === ing.ingredient_id) ||
        (f.canonical_code && f.canonical_code === ing.canonical_code)
      );
      for (const item of matching) {
        if (remaining <= 0 || item.quantity == null) break;
        // Convert both to base unit for comparison
        const needBase = toBaseQuantity(remaining, ing.unit_code, unitsMap);
        const haveBase = toBaseQuantity(item.quantity, item.unit_code, unitsMap);
        if (needBase.converted && haveBase.converted && needBase.unitCode === haveBase.unitCode) {
          const deductBase = Math.min(haveBase.quantity, needBase.quantity);
          // Convert deducted back to ingredient's unit for reporting
          const deductInEntryUnit = ing.unit_code && unitsMap.get(ing.unit_code)?.to_base_factor
            ? deductBase / unitsMap.get(ing.unit_code).to_base_factor
            : deductBase;
          ing.inventory_deducted = (ing.inventory_deducted || 0) + deductInEntryUnit;
          remaining = needBase.quantity - deductBase;
          // Convert remaining back to entry unit
          if (ing.unit_code && unitsMap.get(ing.unit_code)?.to_base_factor) {
            remaining = remaining / unitsMap.get(ing.unit_code).to_base_factor;
          }
        } else if (item.unit_code === ing.unit_code) {
          const deduct = Math.min(item.quantity, remaining);
          ing.inventory_deducted = (ing.inventory_deducted || 0) + deduct;
          remaining -= deduct;
        }
      }
      ing.missing_quantity = Math.max(0, remaining);
    }
    return ingredients;
  }

  // Deduct pantry staples: assume_available=true with null quantity means fully available
  async function deductPantry(tx, familyId, ingredients) {
    const pantry = (await tx.query(`
      SELECT ps.*, i.display_name as ingredient_name, i.canonical_code
      FROM pantry_staples ps LEFT JOIN ingredients i ON i.id = ps.ingredient_id
      WHERE ps.family_id=$1`, [familyId])).rows;
    for (const ing of ingredients) {
      const matching = pantry.filter(p =>
        (p.ingredient_id && p.ingredient_id === ing.ingredient_id) ||
        (p.canonical_code && p.canonical_code === ing.canonical_code)
      );
      if (matching.length > 0 && ing.missing_quantity != null) {
        // If any matching pantry has assume_available=true and quantity=null, fully deduct
        const unlimited = matching.some(p => p.assume_available && p.quantity == null);
        if (unlimited) {
          ing.pantry_deducted = ing.missing_quantity;
          ing.missing_quantity = 0;
        } else {
          const pantryQty = matching.reduce((sum, p) => sum + (p.assume_available && p.quantity ? p.quantity : 0), 0);
          const deduct = Math.min(ing.missing_quantity, pantryQty);
          ing.pantry_deducted = deduct;
          ing.missing_quantity = Math.max(0, ing.missing_quantity - deduct);
        }
      }
    }
    return ingredients;
  }

  async function getCurrentList(familyId, userId) {
    return access(familyId, userId, null, false, async tx => {
      const list = (await tx.query(`SELECT * FROM shopping_lists WHERE family_id=$1 AND status='OPEN' ORDER BY created_at DESC LIMIT 1`, [familyId])).rows[0];
      if (!list) return null;
      const items = (await tx.query(`
        SELECT sli.*, i.display_name as ingredient_name, i.canonical_code, i.category_code
        FROM shopping_list_items sli
        LEFT JOIN ingredients i ON i.id = sli.ingredient_id
        WHERE sli.shopping_list_id=$1
        ORDER BY sli.created_at`, [list.id])).rows;
      // meal_summary from meal_id JOIN
      let mealSummary = null;
      if (list.meal_id) {
        const mealRow = (await tx.query('SELECT * FROM meals WHERE id=$1', [list.meal_id])).rows[0];
        if (mealRow) {
          const mealItems = (await tx.query('SELECT mi.*, r.name as recipe_name FROM meal_items mi LEFT JOIN recipes r ON r.id = mi.recipe_id WHERE mi.meal_id=$1 ORDER BY mi.sort_order', [list.meal_id])).rows;
          const mtLabel = { BREAKFAST: '早餐', LUNCH: '午餐', DINNER: '晚餐' }[mealRow.meal_type] || mealRow.meal_type;
          mealSummary = { title: mealRow.meal_date + ' ' + mtLabel, meal_date: mealRow.meal_date, meal_type: mealRow.meal_type, diners_count: mealRow.diners_count, recipes: mealItems.map(mi => mi.recipe_name || '菜谱').filter(Boolean) };
        }
      }
      return { ...list, meal_summary: mealSummary, items: items.map(i => ({ ...i, name: i.display_name_override || i.ingredient_name })) };
    });
  }

  async function generateList(familyId, userId, body) {
    return access(familyId, userId, null, true, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2', [body.meal_id, familyId])).rows[0];
      if (!meal) throw new ApiError(404, 'NOT_FOUND', '本餐菜单不存在');
      const unitsRows = (await tx.query('SELECT * FROM units')).rows;
      const unitsMap = new Map(unitsRows.map(u => [u.code, u]));

      let list = (await tx.query(`SELECT * FROM shopping_lists WHERE family_id=$1 AND status='OPEN' FOR UPDATE`, [familyId])).rows[0];
      if (!list) {
        list = (await tx.query(`INSERT INTO shopping_lists(id,family_id,meal_id,status,generated_at,created_by_user_id)
          VALUES($1,$2,$3,'OPEN',now(),$4) RETURNING *`, [randomUUID(), familyId, body.meal_id, userId])).rows[0];
      }
      if (body.mode === 'REPLACE_GENERATED') {
        await tx.query("DELETE FROM shopping_list_items WHERE shopping_list_id=$1 AND source='GENERATED'", [list.id]);
      }
      let ingredients = await calculateMealIngredients(tx, body.meal_id, meal.diners_count, unitsMap);
      ingredients = await deductFridge(tx, familyId, ingredients, unitsMap);
      ingredients = await deductPantry(tx, familyId, ingredients);

      let added = 0;
      for (const ing of ingredients) {
        // required = original needed; missing = after deductions
        const requiredQty = ing.quantity || null;
        const invDed = ing.inventory_deducted || 0;
        const panDed = ing.pantry_deducted || 0;
        const missingQty = ing.missing_quantity != null ? ing.missing_quantity : requiredQty;
        // Only add if missing > 0 OR needs unit confirmation
        if ((missingQty != null && missingQty > 0) || ing.needs_unit_confirmation) {
          const existing = (await tx.query('SELECT id FROM shopping_list_items WHERE shopping_list_id=$1 AND ingredient_id=$2 AND unit_code IS NOT DISTINCT FROM $3 AND source=\'GENERATED\'', [list.id, ing.ingredient_id, ing.unit_code])).rows[0];
          if (!existing) {
            await tx.query(`INSERT INTO shopping_list_items(id,shopping_list_id,ingredient_id,display_name_override,required_quantity,required_quantity_text,unit_code,inventory_deducted,pantry_deducted,missing_quantity,sources,is_purchased,source,needs_unit_confirmation,created_by_user_id)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,'GENERATED',$12,$13)`,
              [randomUUID(), list.id, ing.ingredient_id, ing.name, requiredQty, ing.quantity_text, ing.unit_code,
               invDed, panDed, missingQty, JSON.stringify(ing.sources || []), ing.needs_unit_confirmation || false, userId]);
            added++;
          }
        }
      }
      await tx.query('UPDATE shopping_lists SET generated_at=now(), updated_at=now() WHERE id=$1', [list.id]);
      const items = (await tx.query('SELECT * FROM shopping_list_items WHERE shopping_list_id=$1 ORDER BY created_at', [list.id])).rows;
      return { ...list, items, generated_count: added };
    });
  }

  async function addManualItem(familyId, userId, listId, body) {
    return access(familyId, userId, null, true, async tx => {
      const list = (await tx.query('SELECT * FROM shopping_lists WHERE id=$1 AND family_id=$2 AND status=$3', [listId, familyId, 'OPEN'])).rows[0];
      if (!list) throw new ApiError(404, 'NOT_FOUND', '购物清单不存在或已关闭');
      const reqQty = body.required_quantity != null ? body.required_quantity : (body.quantity != null ? body.quantity : null)
      const reqQtyText = body.required_quantity_text || body.quantity_text || null
      const item = (await tx.query(`INSERT INTO shopping_list_items(id,shopping_list_id,ingredient_id,display_name_override,required_quantity,required_quantity_text,unit_code,is_purchased,source,note,created_by_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,false,'MANUAL',$8,$9) RETURNING *`,
        [randomUUID(), listId, body.ingredient_id || null, body.name || body.display_name_override, reqQty,
         reqQtyText, body.unit_code || null, body.note || null, userId])).rows[0];
      return item;
    });
  }

  async function updateItem(familyId, userId, listId, itemId, body) {
    return access(familyId, userId, null, true, async tx => {
      const fields = ['is_purchased', 'purchased_quantity', 'required_quantity', 'required_quantity_text', 'unit_code', 'note', 'display_name_override'];
      const keys = fields.filter(k => k in body);
      const values = keys.map(k => body[k]);
      const set = keys.map((k, i) => `${k}=$${i + 1}`);
      set.push('updated_at=now()');
      values.push(itemId, listId);
      const result = await tx.query(`UPDATE shopping_list_items SET ${set.join(',')} WHERE id=$${values.length - 1} AND shopping_list_id=$${values.length} RETURNING *`, values);
      if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND', '商品不存在');
      return result.rows[0];
    });
  }

  async function deleteItem(familyId, userId, listId, itemId) {
    return access(familyId, userId, null, true, async tx => {
      await tx.query('DELETE FROM shopping_list_items WHERE id=$1 AND shopping_list_id=$2', [itemId, listId]);
      return { ok: true };
    });
  }

  async function completeList(familyId, userId, listId, body) {
    return access(familyId, userId, null, true, async tx => {
      const list = (await tx.query('SELECT * FROM shopping_lists WHERE id=$1 AND family_id=$2 AND status=$3 FOR UPDATE', [listId, familyId, 'OPEN'])).rows[0];
      if (!list) throw new ApiError(404, 'NOT_FOUND', '购物清单不存在或已关闭');
      const purchasedItems = (await tx.query('SELECT * FROM shopping_list_items WHERE shopping_list_id=$1 AND is_purchased=true', [listId])).rows;
      const purchaseDetails = body && body.items ? body.items : [];

      for (const item of purchasedItems) {
        const detail = purchaseDetails.find(d => d.item_id === item.id) || {};
        const storageLocation = detail.storage_location || 'REFRIGERATED';
        const expiryDate = detail.expiry_date || null;
        // Default purchase quantity: explicit detail > item.purchased_quantity > missing (GENERATED) > required (MANUAL fallback)
        const actualQty = Number(
          detail.purchased_quantity != null
            ? detail.purchased_quantity
            : item.purchased_quantity != null
              ? item.purchased_quantity
              : item.missing_quantity != null
                ? item.missing_quantity
                : item.required_quantity
        );

        // Try to merge with existing compatible fridge batch
        const existing = (await tx.query(`
          SELECT * FROM fridge_items
          WHERE family_id=$1 AND ingredient_id=$2 AND unit_code=$3 AND storage_location=$4 AND (expiry_date IS NOT DISTINCT FROM $5)
          FOR UPDATE`, [familyId, item.ingredient_id, item.unit_code, storageLocation, expiryDate])).rows[0];

        let fridgeItemId;
        if (existing) {
          const newQty = Number(existing.quantity || 0) + (actualQty || 0);
          await tx.query('UPDATE fridge_items SET quantity=$1, version=version+1, updated_at=now() WHERE id=$2', [newQty, existing.id]);
          fridgeItemId = existing.id;
        } else {
          fridgeItemId = randomUUID();
          await tx.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,display_name_override,quantity,quantity_text,unit_code,storage_location,expiry_date,note,created_by_user_id,version)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1)`,
            [fridgeItemId, familyId, item.ingredient_id, item.display_name_override, actualQty,
             item.required_quantity_text, item.unit_code, storageLocation, expiryDate, item.note, userId]);
        }
        // Inventory movement
        await tx.query(`INSERT INTO inventory_movements(id,family_id,fridge_item_id,ingredient_id,movement_type,quantity_delta,unit_code,shopping_item_id,performed_by_user_id)
          VALUES($1,$2,$3,$4,'PURCHASE_IN',$5,$6,$7,$8)`,
          [randomUUID(), familyId, fridgeItemId, item.ingredient_id, actualQty || 0, item.unit_code, item.id, userId]);
      }
      await tx.query("UPDATE shopping_lists SET status='COMPLETED', updated_at=now() WHERE id=$1", [listId]);
      return { ok: true, purchased_count: purchasedItems.length };
    });
  }

  return { getCurrentList, generateList, addManualItem, updateItem, deleteItem, completeList };
}

module.exports = { createShoppingService };
