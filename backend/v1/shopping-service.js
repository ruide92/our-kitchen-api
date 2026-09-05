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

  // Calculate required ingredients from meal items
  async function calculateMealIngredients(tx, mealId, dinersCount) {
    const items = (await tx.query(`
      SELECT mi.*, r.base_servings
      FROM meal_items mi JOIN recipes r ON r.id = mi.recipe_id
      WHERE mi.meal_id = $1`, [mealId])).rows;
    const ingredientMap = new Map();
    for (const item of items) {
      const ratio = item.servings / (item.base_servings || 2);
      const ingredients = (await tx.query('SELECT * FROM recipe_ingredients WHERE recipe_id=$1 AND required=true', [item.recipe_id])).rows;
      for (const ing of ingredients) {
        const key = ing.ingredient_id || ing.name;
        if (!ingredientMap.has(key)) {
          ingredientMap.set(key, {
            ingredient_id: ing.ingredient_id, name: ing.name,
            unit_code: ing.unit_code, quantity: 0, quantity_text: ing.quantity_text,
            needs_unit_confirmation: !ing.unit_code && !!ing.quantity_text,
            sources: []
          });
        }
        const entry = ingredientMap.get(key);
        if (ing.quantity) entry.quantity += ing.quantity * ratio;
        entry.sources.push({ recipe_id: item.recipe_id, quantity: ing.quantity, quantity_text: ing.quantity_text, unit_code: ing.unit_code });
      }
    }
    return Array.from(ingredientMap.values());
  }

  // Deduct fridge inventory
  async function deductFridge(tx, familyId, ingredients) {
    const fridge = (await tx.query('SELECT * FROM fridge_items WHERE family_id=$1', [familyId])).rows;
    for (const ing of ingredients) {
      let remaining = ing.quantity || 0;
      const matching = fridge.filter(f => (f.ingredient_id && f.ingredient_id === ing.ingredient_id) || f.name === ing.name);
      for (const item of matching) {
        if (remaining <= 0) break;
        if (item.quantity && item.unit_code === ing.unit_code) {
          const deduct = Math.min(item.quantity, remaining);
          ing.inventory_deducted = (ing.inventory_deducted || 0) + deduct;
          remaining -= deduct;
        }
      }
      ing.missing_quantity = ing.quantity ? Math.max(0, ing.quantity - (ing.inventory_deducted || 0)) : null;
    }
    return ingredients;
  }

  // Deduct pantry staples
  async function deductPantry(tx, familyId, ingredients) {
    const pantry = (await tx.query('SELECT * FROM pantry_staples WHERE family_id=$1 AND assume_available=true', [familyId])).rows;
    for (const ing of ingredients) {
      const matching = pantry.filter(p => (p.ingredient_id && p.ingredient_id === ing.ingredient_id) || p.name === ing.name);
      if (matching.length > 0 && ing.missing_quantity) {
        const pantryQty = matching.reduce((sum, p) => sum + (p.quantity || 0), 0);
        const deduct = Math.min(ing.missing_quantity, pantryQty);
        ing.pantry_deducted = deduct;
        ing.missing_quantity = Math.max(0, ing.missing_quantity - deduct);
      }
    }
    return ingredients;
  }

  async function getCurrentList(familyId, userId) {
    return access(familyId, userId, null, false, async tx => {
      const list = (await tx.query(`SELECT * FROM shopping_lists WHERE family_id=$1 AND status='OPEN' ORDER BY created_at DESC LIMIT 1`, [familyId])).rows[0];
      if (!list) return null;
      const items = (await tx.query('SELECT * FROM shopping_list_items WHERE list_id=$1 ORDER BY category,name', [list.id])).rows;
      return { ...list, items };
    });
  }

  async function generateList(familyId, userId, body) {
    return access(familyId, userId, null, true, async tx => {
      const meal = (await tx.query('SELECT * FROM meals WHERE id=$1 AND family_id=$2', [body.meal_id, familyId])).rows[0];
      if (!meal) throw new ApiError(404, 'NOT_FOUND', '本餐菜单不存在');
      let list = (await tx.query(`SELECT * FROM shopping_lists WHERE family_id=$1 AND status='OPEN' FOR UPDATE`, [familyId])).rows[0];
      if (!list) {
        list = (await tx.query(`INSERT INTO shopping_lists(id,family_id,meal_id,status,generated_at,created_by_user_id)
          VALUES($1,$2,$3,'OPEN',now(),$4) RETURNING *`, [randomUUID(), familyId, body.meal_id, userId])).rows[0];
      }
      // Remove old GENERATED items if REPLACE_GENERATED
      if (body.mode === 'REPLACE_GENERATED') {
        await tx.query("DELETE FROM shopping_list_items WHERE list_id=$1 AND source='GENERATED'", [list.id]);
      }
      // Calculate ingredients
      let ingredients = await calculateMealIngredients(tx, body.meal_id, meal.diners_count);
      ingredients = await deductFridge(tx, familyId, ingredients);
      ingredients = await deductPantry(tx, familyId, ingredients);
      // Insert only items with missing quantity > 0 or needs unit confirmation
      const categoryMap = { '蔬菜': 'VEGETABLE', '肉蛋': 'MEAT', '水产': 'SEAFOOD', '乳品': 'DAIRY', '主食': 'STAPLE', '干货': 'DRY', '其他': 'OTHER' };
      for (const ing of ingredients) {
        if ((ing.missing_quantity && ing.missing_quantity > 0) || ing.needs_unit_confirmation) {
          const missingText = ing.needs_unit_confirmation ? ing.quantity_text : (ing.missing_quantity + (ing.unit_code || ''));
          await tx.query(`INSERT INTO shopping_list_items(id,list_id,ingredient_id,name,category,source,required_quantity,required_quantity_text,unit_code,inventory_deducted,pantry_deducted,missing_quantity,missing_quantity_text,needs_unit_confirmation,calculation_evidence)
            VALUES($1,$2,$3,$4,'OTHER','GENERATED',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [randomUUID(), list.id, ing.ingredient_id, ing.name, ing.quantity, ing.quantity_text, ing.unit_code,
             ing.inventory_deducted || 0, ing.pantry_deducted || 0, ing.missing_quantity, missingText,
             ing.needs_unit_confirmation, JSON.stringify({ sources: ing.sources })]);
        }
      }
      await tx.query('UPDATE shopping_lists SET generated_at=now(),updated_at=now() WHERE id=$1', [list.id]);
      const items = (await tx.query('SELECT * FROM shopping_list_items WHERE list_id=$1 ORDER BY category,name', [list.id])).rows;
      return { ...list, items };
    });
  }

  async function addManualItem(familyId, userId, listId, body) {
    return access(familyId, userId, null, true, async tx => {
      const list = (await tx.query('SELECT * FROM shopping_lists WHERE id=$1 AND family_id=$2 AND status=$3', [listId, familyId, 'OPEN'])).rows[0];
      if (!list) throw new ApiError(404, 'NOT_FOUND', '购物清单不存在');
      const item = (await tx.query(`INSERT INTO shopping_list_items(id,list_id,name,category,source,required_quantity,required_quantity_text,unit_code,note)
        VALUES($1,$2,$3,$4,'MANUAL',$5,$6,$7,$8) RETURNING *`,
        [randomUUID(), listId, body.name, body.category || 'OTHER', body.quantity || null,
         body.quantity_text || null, body.unit_code || null, body.note || null])).rows[0];
      return item;
    });
  }

  async function updateItem(familyId, userId, listId, itemId, body) {
    return access(familyId, userId, null, true, async tx => {
      const fields = ['required_quantity', 'required_quantity_text', 'unit_code', 'purchased_quantity', 'is_purchased', 'note'];
      const keys = fields.filter(k => k in body);
      const values = keys.map(k => body[k]);
      const set = keys.map((k, i) => `${k}=$${i + 1}`);
      set.push('updated_at=now()');
      values.push(itemId, listId);
      const result = await tx.query(`UPDATE shopping_list_items SET ${set.join(',')} WHERE id=$${values.length - 1} AND list_id=$${values.length} RETURNING *`, values);
      if (!result.rows[0]) throw new ApiError(404, 'NOT_FOUND', '商品不存在');
      return result.rows[0];
    });
  }

  async function deleteItem(familyId, userId, listId, itemId) {
    return access(familyId, userId, null, true, async tx => {
      await tx.query('DELETE FROM shopping_list_items WHERE id=$1 AND list_id=$2', [itemId, listId]);
      return { ok: true };
    });
  }

  async function completeList(familyId, userId, listId, body) {
    return access(familyId, userId, null, true, async tx => {
      const list = (await tx.query('SELECT * FROM shopping_lists WHERE id=$1 AND family_id=$2 AND status=$3 FOR UPDATE', [listId, familyId, 'OPEN'])).rows[0];
      if (!list) throw new ApiError(404, 'NOT_FOUND', '购物清单不存在');
      const purchased = (await tx.query('SELECT * FROM shopping_list_items WHERE list_id=$1 AND is_purchased=true', [listId])).rows;
      // Add purchased items to fridge
      for (const item of purchased) {
        const qty = item.purchased_quantity || item.missing_quantity || item.required_quantity;
        const fridgeId = randomUUID();
        await tx.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,name,quantity,quantity_text,unit_code,storage_location,note)
          VALUES($1,$2,$3,$4,$5,$6,$7,'REFRIGERATED','购物入库')`,
          [fridgeId, familyId, item.ingredient_id, item.name, qty, item.required_quantity_text, item.unit_code]);
        await tx.query(`INSERT INTO inventory_movements(id,family_id,fridge_item_id,ingredient_id,movement_type,quantity_delta,unit_code,reference_type,reference_id,created_by_user_id)
          VALUES($1,$2,$3,$4,'SHOPPING_COMPLETE',$5,$6,'SHOPPING_LIST',$7,$8)`,
          [randomUUID(), familyId, fridgeId, item.ingredient_id, qty, item.unit_code, listId, userId]);
      }
      await tx.query(`UPDATE shopping_lists SET status='COMPLETED',completed_at=now(),updated_at=now() WHERE id=$1`, [listId]);
      return { ok: true, purchased_count: purchased.length };
    });
  }

  return { getCurrentList, generateList, addManualItem, updateItem, deleteItem, completeList };
}

module.exports = { createShoppingService };
