// Recipe Import Service — V4 KRP v2
// Parse -> validate -> preview -> user confirm -> FAMILY recipe
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize } = require('./family-access');

function createRecipeImportService(pool) {
  async function access(familyId, userId, roles, write, work) {
    return withTransaction(pool, async tx => {
      const family = (await tx.query(`SELECT id FROM families WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ' FOR SHARE'}`, [familyId])).rows[0];
      if (!family) throw new ApiError(403, 'FAMILY_FORBIDDEN', '你不是该家庭成员');
      await authorize(tx, familyId, userId, roles);
      return work(tx);
    });
  }

  // Extract KRP from wrapper or raw JSON
  function extractKrp(text) {
    if (!text) throw new ApiError(400, 'EMPTY_PAYLOAD', '请粘贴菜谱内容');
    const trimmed = text.trim();
    // Try wrapper: <KITCHEN_RECIPE_PACK version="2.0">{...}</KITCHEN_RECIPE_PACK>
    const wrapperMatch = trimmed.match(/<KITCHEN_RECIPE_PACK[^>]*>([\s\S]*?)<\/KITCHEN_RECIPE_PACK>/i);
    const jsonStr = wrapperMatch ? wrapperMatch[1].trim() : trimmed;
    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      throw new ApiError(400, 'INVALID_JSON', '菜谱内容格式错误，请粘贴有效的 JSON 或 KRP 包');
    }
  }

  // Validate KRP schema
  function validateKrp(krp) {
    const errors = [];
    const warnings = [];
    const inferredFields = [];
    const uncertainFields = [];

    if (!krp.schema_version || krp.schema_version !== '2.0') {
      errors.push({ path: '/schema_version', reason: '必须为 2.0' });
    }
    if (!krp.recipe || !krp.recipe.name) {
      errors.push({ path: '/recipe/name', reason: '菜名不能为空' });
    }
    if (krp.recipe && krp.recipe.base_servings != null && krp.recipe.base_servings < 1) {
      errors.push({ path: '/recipe/base_servings', reason: '基础人数必须 >= 1' });
    }
    ['spiciness','sweetness','saltiness','sourness','oiliness'].forEach(k => {
      if (krp.recipe && krp.recipe[k] != null && (krp.recipe[k] < 0 || krp.recipe[k] > 5)) {
        errors.push({ path: `/recipe/${k}`, reason: '口味值必须 0-5' });
      }
    });
    if (!Array.isArray(krp.ingredients) || krp.ingredients.length === 0) {
      errors.push({ path: '/ingredients', reason: '至少需要一项食材' });
    }
    if (Array.isArray(krp.ingredients)) {
      krp.ingredients.forEach((ing, i) => {
        if (!ing.name) errors.push({ path: `/ingredients/${i}/name`, reason: '食材名不能为空' });
        if (ing.quantity == null && !ing.quantity_text) {
          warnings.push({ path: `/ingredients/${i}`, reason: `${ing.name || '未知食材'} 没有数量` });
        }
        if (ing.quantity != null && !ing.unit_code && !ing.quantity_text) {
          uncertainFields.push({ path: `/ingredients/${i}/unit_code`, reason: `${ing.name} 有数量但无单位`, confidence: 'LOW' });
        }
      });
    }
    if (!Array.isArray(krp.steps) || krp.steps.length === 0) {
      warnings.push({ path: '/steps', reason: '没有做法步骤' });
    }
    if (!krp.nutrition || krp.nutrition.status === 'ESTIMATED') {
      warnings.push({ path: '/nutrition', reason: '营养数据为估算值，仅供参考' });
    }

    return { errors, warnings, inferredFields, uncertainFields };
  }

  // Parse and create import record
  async function parseImport(familyId, userId, body) {
    return access(familyId, userId, null, true, async tx => {
      const krpText = body.krp_text || body.text || body.raw_payload;
      const krp = extractKrp(krpText);
      const { errors, warnings, inferredFields, uncertainFields } = validateKrp(krp);

      const id = randomUUID();
      const status = errors.length > 0 ? 'NEEDS_REVIEW' : 'VALIDATED';

      await tx.query(`INSERT INTO recipe_imports(id,family_id,created_by_user_id,schema_version,raw_payload,normalized_payload,status,inferred_fields,uncertain_fields)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, familyId, userId, krp.schema_version || '2.0',
         JSON.stringify(typeof krpText === 'string' ? krpText : body),
         JSON.stringify(krp), status,
         JSON.stringify(inferredFields), JSON.stringify(uncertainFields)]);

      return {
        id,
        status,
        errors,
        warnings,
        inferred_fields: inferredFields,
        uncertain_fields: uncertainFields,
        preview: krp
      };
    });
  }

  // Update normalized payload (user edits in preview)
  async function updateImport(familyId, userId, importId, body) {
    return access(familyId, userId, null, true, async tx => {
      const imp = (await tx.query('SELECT * FROM recipe_imports WHERE id=$1 AND family_id=$2', [importId, familyId])).rows[0];
      if (!imp) throw new ApiError(404, 'IMPORT_NOT_FOUND', '导入记录不存在');
      if (imp.status === 'IMPORTED') throw new ApiError(409, 'ALREADY_IMPORTED', '该菜谱已导入');

      const normalized = body.normalized_payload || body;
      const { errors, warnings, inferredFields, uncertainFields } = validateKrp(normalized);
      const status = errors.length > 0 ? 'NEEDS_REVIEW' : 'VALIDATED';

      await tx.query(`UPDATE recipe_imports SET normalized_payload=$1, status=$2, inferred_fields=$3, uncertain_fields=$4, updated_at=now() WHERE id=$5`,
        [JSON.stringify(normalized), status, JSON.stringify(inferredFields), JSON.stringify(uncertainFields), importId]);

      return { id: importId, status, errors, warnings };
    });
  }

  // Validate (re-run validation)
  async function validateImport(familyId, userId, importId) {
    return access(familyId, userId, null, false, async tx => {
      const imp = (await tx.query('SELECT * FROM recipe_imports WHERE id=$1 AND family_id=$2', [importId, familyId])).rows[0];
      if (!imp) throw new ApiError(404, 'IMPORT_NOT_FOUND', '导入记录不存在');
      const krp = imp.normalized_payload;
      const { errors, warnings } = validateKrp(krp);
      return { id: importId, status: imp.status, errors, warnings };
    });
  }

  // Confirm: create FAMILY recipe from validated import
  async function confirmImport(familyId, userId, importId) {
    return access(familyId, userId, ['OWNER','ADMIN','MEMBER'], true, async tx => {
      const imp = (await tx.query('SELECT * FROM recipe_imports WHERE id=$1 AND family_id=$2', [importId, familyId])).rows[0];
      if (!imp) throw new ApiError(404, 'IMPORT_NOT_FOUND', '导入记录不存在');
      if (imp.status !== 'VALIDATED') throw new ApiError(409, 'NOT_VALIDATED', `当前状态 ${imp.status}，请先修正错误`);

      const krp = imp.normalized_payload;
      const r = krp.recipe || {};

      // Create recipe
      const recipeId = randomUUID();
      await tx.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,description,category_code,cuisine_code,base_servings,cook_time_minutes,difficulty,
        spiciness,sweetness,saltiness,sourness,oiliness,cooking_method_code,protein_source_code,suggested_kiss,visibility,created_by_user_id,updated_by_user_id,version)
        VALUES($1,'FAMILY',$2,'KRP_IMPORT',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'PRIVATE',$18,$18,1)`,
        [recipeId, familyId, r.name, r.description || null, r.category_code || 'HOT_DISH', r.cuisine_code || null,
         r.base_servings || 2, r.cook_time_minutes || null, r.difficulty || 2,
         r.spiciness != null ? r.spiciness : null, r.sweetness != null ? r.sweetness : null,
         r.saltiness != null ? r.saltiness : null, r.sourness != null ? r.sourness : null,
         r.oiliness != null ? r.oiliness : null, r.cooking_method_code || null,
         r.protein_source_code || null, r.suggested_kiss != null ? r.suggested_kiss : null, userId]);

      // Meal types
      if (Array.isArray(r.meal_types)) {
        for (const mt of r.meal_types) {
          await tx.query('INSERT INTO recipe_meal_types(recipe_id,meal_type) VALUES($1,$2)', [recipeId, mt]);
        }
      }
      // Cookware
      if (Array.isArray(r.cookware)) {
        for (const cw of r.cookware) {
          await tx.query('INSERT INTO recipe_cookware(recipe_id,cookware_code) VALUES($1,$2)', [recipeId, cw]);
        }
      }
      // Tags
      if (Array.isArray(r.tags)) {
        for (const tag of r.tags) {
          await tx.query('INSERT INTO recipe_tags(recipe_id,tag_code) VALUES($1,$2)', [recipeId, tag]);
        }
      }
      // Allergens
      if (Array.isArray(r.allergens)) {
        for (const a of r.allergens) {
          await tx.query('INSERT INTO recipe_allergens(recipe_id,allergen_code) VALUES($1,$2)', [recipeId, a]);
        }
      }

      // Ingredients — resolve canonical where possible, keep custom as display_name_override
      if (Array.isArray(krp.ingredients)) {
        let sortOrder = 0;
        for (const ing of krp.ingredients) {
          let ingredientId = null;
          if (ing.canonical_code) {
            const found = (await tx.query('SELECT id FROM ingredients WHERE canonical_code=$1', [ing.canonical_code])).rows[0];
            if (found) ingredientId = found.id;
          }
          if (!ingredientId && ing.name) {
            const found = (await tx.query(`SELECT i.id FROM ingredients i
              LEFT JOIN ingredient_aliases ia ON ia.ingredient_id = i.id
              WHERE i.display_name=$1 OR ia.alias_name=$1 LIMIT 1`, [ing.name])).rows[0];
            if (found) ingredientId = found.id;
          }
          await tx.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,quantity_text,unit_code,type,required,sort_order,note)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [randomUUID(), recipeId, ingredientId, ingredientId ? null : ing.name,
             ing.quantity != null ? ing.quantity : null, ing.quantity_text || null,
             ing.unit_code || null, ing.type || 'MAIN', ing.required != null ? ing.required : true,
             sortOrder++, ing.note || null]);
        }
      }

      // Steps
      if (Array.isArray(krp.steps)) {
        let sortOrder = 0;
        for (const step of krp.steps) {
          await tx.query(`INSERT INTO recipe_steps(id,recipe_id,step_no,title,operation,duration_seconds,duration_text,heat_code,doneness_cue,tip,sort_order)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [randomUUID(), recipeId, step.step || (sortOrder + 1), step.title || null,
             step.operation || '', step.duration_seconds || null, step.duration_text || null,
             step.heat_code || null, step.doneness_cue || null, step.tip || null, sortOrder++]);
        }
      }

      // Update import status
      await tx.query(`UPDATE recipe_imports SET status='IMPORTED', imported_recipe_id=$2, updated_at=now() WHERE id=$1`, [importId, recipeId]);

      return { recipe_id: recipeId, name: r.name, status: 'IMPORTED' };
    });
  }

  return { parseImport, updateImport, validateImport, confirmImport };
}

module.exports = { createRecipeImportService };
