const { randomUUID } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize, forbidden } = require('./family-access');

function createFridgeService(pool) {
  async function access(familyId, userId, roles, write, work) {
    return withTransaction(pool, async tx => {
      const family = (await tx.query(`SELECT id FROM families WHERE id=$1 AND deleted_at IS NULL${write ? ' FOR UPDATE' : ' FOR SHARE'}`, [familyId])).rows[0];
      if (!family) throw forbidden();
      await authorize(tx, familyId, userId, roles);
      return work(tx);
    });
  }

  async function listFridge(familyId, userId, query) {
    return access(familyId, userId, null, false, async tx => {
      const conditions = ['family_id = $1'];
      const params = [familyId];
      let idx = 2;
      if (query.storage_location) { conditions.push('storage_location = $' + idx++); params.push(query.storage_location); }
      const rows = (await tx.query(`SELECT * FROM fridge_items WHERE ${conditions.join(' AND ')} ORDER BY expiry_date NULLS LAST, name`, params)).rows;
      return rows;
    });
  }

  async function addFridgeItem(familyId, userId, body) {
    return access(familyId, userId, null, true, async tx => {
      const id = randomUUID();
      const item = (await tx.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,name,quantity,quantity_text,unit_code,storage_location,purchase_date,expiry_date,note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [id, familyId, body.ingredient_id || null, body.name, body.quantity || null, body.quantity_text || null,
         body.unit_code || null, body.storage_location || 'REFRIGERATED', body.purchase_date || null,
         body.expiry_date || null, body.note || null])).rows[0];
      await tx.query(`INSERT INTO inventory_movements(id,family_id,fridge_item_id,ingredient_id,movement_type,quantity_delta,unit_code,reference_type,created_by_user_id)
        VALUES($1,$2,$3,$4,'PURCHASE',$5,$6,'FRIDGE_ADD',$7)`,
        [randomUUID(), familyId, id, body.ingredient_id || null, body.quantity || null, body.unit_code || null, userId]);
      return item;
    });
  }

  async function updateFridgeItem(familyId, userId, itemId, body) {
    return access(familyId, userId, null, true, async tx => {
      const existing = (await tx.query('SELECT * FROM fridge_items WHERE id=$1 AND family_id=$2 FOR UPDATE', [itemId, familyId])).rows[0];
      if (!existing) throw new ApiError(404, 'NOT_FOUND', '食材不存在');
      const fields = ['quantity', 'quantity_text', 'unit_code', 'storage_location', 'purchase_date', 'expiry_date', 'note'];
      const keys = fields.filter(k => k in body);
      const values = keys.map(k => body[k]);
      const set = keys.map((k, i) => `${k}=$${i + 1}`);
      set.push('version=version+1', 'updated_at=now()');
      values.push(itemId, body.version || existing.version);
      const result = await tx.query(`UPDATE fridge_items SET ${set.join(',')} WHERE id=$${values.length - 1} AND version=$${values.length} RETURNING *`, values);
      if (!result.rows[0]) throw new ApiError(409, 'VERSION_CONFLICT', '版本已更新，请刷新');
      return result.rows[0];
    });
  }

  async function deleteFridgeItem(familyId, userId, itemId) {
    return access(familyId, userId, null, true, async tx => {
      const item = (await tx.query('SELECT * FROM fridge_items WHERE id=$1 AND family_id=$2', [itemId, familyId])).rows[0];
      if (!item) throw new ApiError(404, 'NOT_FOUND', '食材不存在');
      await tx.query('DELETE FROM fridge_items WHERE id=$1', [itemId]);
      await tx.query(`INSERT INTO inventory_movements(id,family_id,fridge_item_id,ingredient_id,movement_type,quantity_delta,unit_code,reference_type,created_by_user_id)
        VALUES($1,$2,$3,$4,'WASTE',$5,$6,'FRIDGE_DELETE',$7)`,
        [randomUUID(), familyId, itemId, item.ingredient_id, -(item.quantity || 0), item.unit_code, userId]);
      return { ok: true };
    });
  }

  async function listPantry(familyId, userId) {
    return access(familyId, userId, null, false, async tx => {
      return (await tx.query('SELECT * FROM pantry_staples WHERE family_id=$1 ORDER BY name', [familyId])).rows;
    });
  }

  async function putPantry(familyId, userId, ingredientId, body) {
    return access(familyId, userId, null, true, async tx => {
      await tx.query(`INSERT INTO pantry_staples(family_id,ingredient_id,name,quantity,unit_code,assume_available)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(family_id,ingredient_id) DO UPDATE SET name=EXCLUDED.name,quantity=EXCLUDED.quantity,unit_code=EXCLUDED.unit_code,assume_available=EXCLUDED.assume_available,updated_at=now()`,
        [familyId, ingredientId, body.name, body.quantity || null, body.unit_code || null, body.assume_available !== false]);
      return { ok: true };
    });
  }

  async function deletePantry(familyId, userId, ingredientId) {
    return access(familyId, userId, null, true, async tx => {
      await tx.query('DELETE FROM pantry_staples WHERE family_id=$1 AND ingredient_id=$2', [familyId, ingredientId]);
      return { ok: true };
    });
  }

  return { listFridge, addFridgeItem, updateFridgeItem, deleteFridgeItem, listPantry, putPantry, deletePantry };
}

module.exports = { createFridgeService };
