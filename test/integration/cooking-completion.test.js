const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');

test('12C Cooking completion + inventory deduction against real PostgreSQL', async t => {
  const connectionString = process.env.TEST_DATABASE_URL;
  assert.ok(connectionString, 'TEST_DATABASE_URL required');
  assert.match(new URL(connectionString).pathname, /_test$/i);
  assert.notEqual(connectionString, process.env.DATABASE_URL);
  const { Pool, types } = require('pg');
  types.setTypeParser(1082, (val) => val);
  const { loadMigrations, migrate } = require('../../backend/v1/migrations');
  const { createRepository } = require('../../backend/v1/repository');
  const { createFamilyService } = require('../../backend/v1/family-service');
  const { createApp } = require('../../backend/v1/app');
  const { createTokens } = require('../../backend/v1/tokens');
  const schema = `cooking_12c_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  let pool, server;
  t.after(async () => {
    try { if (server) await new Promise(resolve => server.close(resolve)); }
    finally { try { if (pool) await pool.end(); } finally {
      try { await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await admin.end(); }
    } }
  });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new Pool({ connectionString, max: 6, connectionTimeoutMillis: 5000, options: `-c search_path=${schema}` });
  await migrate(pool, await loadMigrations(path.join(__dirname, '../../backend/v1/sql')));

  // Seed ingredients
  const ingPork = randomUUID();
  const ingTomato = randomUUID();
  const ingOil = randomUUID();
  await pool.query(`INSERT INTO ingredients(id,canonical_code,display_name,category_code,default_unit_code) VALUES
    ($1,'pork','五花肉','MEAT','g'),($2,'tomato','西红柿','VEGETABLE','g'),($3,'oil','食用油','OIL','ml')`,
    [ingPork, ingTomato, ingOil]);

  // Recipe: 红烧肉 (500g pork + 200g tomato + 30ml oil, 2 servings)
  const recipe = randomUUID();
  await pool.query(`INSERT INTO recipes(id,kind,family_id,source_type,name,base_servings,visibility,version)
    VALUES ($1,'BASE',NULL,'SEED','红烧肉',2,'PUBLIC',1)`, [recipe]);
  await pool.query(`INSERT INTO recipe_ingredients(id,recipe_id,ingredient_id,display_name_override,quantity,unit_code,type,required,sort_order) VALUES
    ($1,$2,$3,'五花肉',500,'g','MAIN',true,0),($4,$2,$5,'西红柿',200,'g','MAIN',true,1),($6,$2,$7,'食用油',30,'ml','SEASONING',true,2)`,
    [randomUUID(), recipe, ingPork, randomUUID(), ingTomato, randomUUID(), ingOil]);
  await pool.query("INSERT INTO recipe_steps(id,recipe_id,step_no,title,operation,sort_order) VALUES ($1,$2,1,'焯水','五花肉冷水下锅',0),($3,$2,2,'炒制','加糖炒色',1)",
    [randomUUID(), recipe, randomUUID()]);

  const repo = createRepository(pool);
  const families = createFamilyService(pool);
  const tokens = createTokens('cooking-12c-test-key-please-use-long-enough-string-0123456789');
  const app = createApp({ repo, families, tokens, pool, wechat: { exchange: async () => { throw new Error('Not used'); } } });
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));

  const user = await repo.upsertWechatUser({ openid: 'cook12c', unionid: null });

  async function request(method, endpoint, body) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1${endpoint}`, {
      method, headers: { Authorization: `Bearer ${tokens.sign(user.id)}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json };
  }

  const familyRes = await request('POST', '/families', { name: '测试厨房' });
  assert.equal(familyRes.status, 201);
  const family = familyRes.body.data;

  let mealCounter = 0;
  // Clean fridge + movements before each test to avoid cross-test contamination
  async function cleanFridge() {
    await pool.query('DELETE FROM fridge_items WHERE family_id=$1', [family.id]);
    await pool.query('DELETE FROM inventory_movements WHERE family_id=$1', [family.id]);
  }

  // Helper: create PLANNING meal with recipe, confirm, start cooking
  async function setupCookingSession() {
    await cleanFridge();
    mealCounter++;
    const d = new Date();
    d.setDate(d.getDate() + mealCounter);
    const mealDate = d.toISOString().slice(0, 10);
    const mealRes = await request('PUT', `/families/${family.id}/meals/current`, { meal_date: mealDate, meal_type: 'DINNER', diners_count: 2 });
    const mealId = mealRes.body.data.id;
    await request('POST', `/families/${family.id}/meals/${mealId}/items`, { recipe_id: recipe, servings: 2, source: 'MANUAL' });
    const confRes = await request('POST', `/families/${family.id}/meals/${mealId}/confirm`);
    if (confRes.status !== 200) throw new Error(`confirm failed: ${confRes.status} ${JSON.stringify(confRes.body)}`);
    const startRes = await request('POST', `/families/${family.id}/meals/${mealId}/cooking-sessions`);
    if (startRes.status !== 201) throw new Error(`start failed: ${startRes.status} ${JSON.stringify(startRes.body)}`);
    return { mealId, sessionId: startRes.body.data.session_id };
  }

  // D1: GET cooking session returns frozen steps
  await t.test('D1: GET cooking session returns frozen steps + consumption candidates', async () => {
    const { mealId, sessionId } = await setupCookingSession();
    const res = await request('GET', `/families/${family.id}/cooking-sessions/${sessionId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'ACTIVE');
    assert.equal(res.body.data.meal.status, 'COOKING');
    assert.ok(Array.isArray(res.body.data.steps));
    assert.equal(res.body.data.steps.length, 2);
    assert.equal(res.body.data.steps[0].operation, '五花肉冷水下锅');
    assert.ok(Array.isArray(res.body.data.consumption_candidates));
    assert.equal(res.body.data.consumption_candidates.length, 3);
    const pork = res.body.data.consumption_candidates.find(c => c.ingredient_id === ingPork);
    assert.equal(pork.suggested_quantity, 500);
    assert.equal(pork.unit_code, 'g');
  });

  // D2: New device resume via GET meals/:meal_id/cooking-session
  await t.test('D2: active session by meal (new device resume)', async () => {
    const { mealId } = await setupCookingSession();
    const res = await request('GET', `/families/${family.id}/meals/${mealId}/cooking-session`);
    assert.equal(res.status, 200);
    assert.ok(res.body.data, 'should return active session');
    assert.equal(res.body.data.status, 'ACTIVE');
    assert.equal(res.body.data.steps.length, 2);
  });

  // D3: consumption with unrelated ingredient -> 422, no deduction
  await t.test('D3: unrelated ingredient rejected, no inventory deduction', async () => {
    const { sessionId } = await setupCookingSession();
    const fakeIng = randomUUID();
    const res = await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, {
      consumption: [{ ingredient_id: fakeIng, quantity: 100, unit_code: 'g' }],
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INGREDIENT_NOT_IN_SNAPSHOT');
    // Session still ACTIVE
    const sess = await request('GET', `/families/${family.id}/cooking-sessions/${sessionId}`);
    assert.equal(sess.body.data.status, 'ACTIVE');
  });

  // D4: 500g consumption from 1kg batch -> 0.5kg remaining
  await t.test('D4: 500g from 1kg batch leaves 0.5kg', async () => {
    const { mealId, sessionId } = await setupCookingSession();
    // Add 1kg pork to fridge
    const fridgeId = randomUUID();
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,created_by_user_id)
      VALUES ($1,$2,$3,1,'kg','REFRIGERATED',$4)`, [fridgeId, family.id, ingPork, user.id]);

    const res = await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, {
      consumption: [{ ingredient_id: ingPork, quantity: 500, unit_code: 'g' }],
    });
    assert.equal(res.status, 200);
    // Check fridge: 1kg - 500g = 0.5kg
    const fi = (await pool.query('SELECT quantity, unit_code FROM fridge_items WHERE id=$1', [fridgeId])).rows[0];
    assert.equal(Number(fi.quantity), 0.5);
    assert.equal(fi.unit_code, 'kg');
    // Check movement: -0.5 kg
    const mv = (await pool.query("SELECT quantity_delta, unit_code FROM inventory_movements WHERE ingredient_id=$1 AND movement_type='COOK_OUT'", [ingPork])).rows[0];
    assert.equal(Number(mv.quantity_delta), -0.5);
    assert.equal(mv.unit_code, 'kg');
  });

  // D5: 500g across 200g + 1kg batches
  await t.test('D5: multi-batch deduction (200g + 1kg for 500g)', async () => {
    const { sessionId } = await setupCookingSession();
    const batchA = randomUUID();
    const batchB = randomUUID();
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,created_by_user_id,expiry_date)
      VALUES ($1,$2,$3,200,'g','REFRIGERATED',$4,'2026-09-10')`, [batchA, family.id, ingPork, user.id]);
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,created_by_user_id,expiry_date)
      VALUES ($1,$2,$3,1,'kg','REFRIGERATED',$4,'2026-12-31')`, [batchB, family.id, ingPork, user.id]);

    const res = await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, {
      consumption: [{ ingredient_id: ingPork, quantity: 500, unit_code: 'g' }],
    });
    assert.equal(res.status, 200);
    // Batch A (200g, earlier expiry) should be deleted
    const a = (await pool.query('SELECT id FROM fridge_items WHERE id=$1', [batchA])).rows;
    assert.equal(a.length, 0, 'batch A should be deleted');
    // Batch B: 1kg - 300g = 0.7kg
    const b = (await pool.query('SELECT quantity, unit_code FROM fridge_items WHERE id=$1', [batchB])).rows[0];
    assert.equal(Number(b.quantity), 0.7);
    assert.equal(b.unit_code, 'kg');
    // Movements: -200g + -0.3kg
    const mvs = (await pool.query("SELECT quantity_delta, unit_code FROM inventory_movements WHERE ingredient_id=$1 AND movement_type='COOK_OUT' ORDER BY created_at", [ingPork])).rows;
    assert.equal(mvs.length, 2);
    assert.equal(Number(mvs[0].quantity_delta), -200);
    assert.equal(mvs[0].unit_code, 'g');
    assert.equal(Number(mvs[1].quantity_delta), -0.3);
    assert.equal(mvs[1].unit_code, 'kg');
  });

  // D6: g <-> kg conversion
  await t.test('D6: g to kg conversion works', async () => {
    const { sessionId } = await setupCookingSession();
    const fridgeId = randomUUID();
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,created_by_user_id)
      VALUES ($1,$2,$3,2,'kg','REFRIGERATED',$4)`, [fridgeId, family.id, ingPork, user.id]);
    const res = await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, {
      consumption: [{ ingredient_id: ingPork, quantity: 1500, unit_code: 'g' }],
    });
    assert.equal(res.status, 200);
    const fi = (await pool.query('SELECT quantity FROM fridge_items WHERE id=$1', [fridgeId])).rows[0];
    assert.equal(Number(fi.quantity), 0.5); // 2kg - 1.5kg = 0.5kg
  });

  // D7: ml <-> l conversion
  await t.test('D7: ml to l conversion works', async () => {
    const { sessionId } = await setupCookingSession();
    const fridgeId = randomUUID();
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,created_by_user_id)
      VALUES ($1,$2,$3,1,'l','REFRIGERATED',$4)`, [fridgeId, family.id, ingOil, user.id]);
    const res = await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, {
      consumption: [{ ingredient_id: ingOil, quantity: 300, unit_code: 'ml' }],
    });
    assert.equal(res.status, 200);
    const fi = (await pool.query('SELECT quantity FROM fridge_items WHERE id=$1', [fridgeId])).rows[0];
    assert.equal(Number(fi.quantity), 0.7); // 1l - 0.3l = 0.7l
  });

  // D8: g vs piece must NOT convert
  await t.test('D8: g vs piece does not convert (insufficient)', async () => {
    const { sessionId } = await setupCookingSession();
    const fridgeId = randomUUID();
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,created_by_user_id)
      VALUES ($1,$2,$3,5,'piece','REFRIGERATED',$4)`, [fridgeId, family.id, ingPork, user.id]);
    const res = await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, {
      consumption: [{ ingredient_id: ingPork, quantity: 100, unit_code: 'g' }],
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'INVENTORY_INSUFFICIENT');
    // Session still ACTIVE, no deduction
    const fi = (await pool.query('SELECT quantity FROM fridge_items WHERE id=$1', [fridgeId])).rows[0];
    assert.equal(Number(fi.quantity), 5);
  });

  // D9: insufficient inventory -> full rollback
  await t.test('D9: insufficient inventory rolls back entire transaction', async () => {
    const { sessionId } = await setupCookingSession();
    const fridgeId = randomUUID();
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,created_by_user_id)
      VALUES ($1,$2,$3,100,'g','REFRIGERATED',$4)`, [fridgeId, family.id, ingPork, user.id]);
    const res = await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, {
      consumption: [{ ingredient_id: ingPork, quantity: 500, unit_code: 'g' }],
    });
    assert.equal(res.status, 422);
    // Session still ACTIVE
    const sess = await request('GET', `/families/${family.id}/cooking-sessions/${sessionId}`);
    assert.equal(sess.body.data.status, 'ACTIVE');
    // No movements written
    const mvs = (await pool.query("SELECT COUNT(*)::int as n FROM inventory_movements WHERE movement_type='COOK_OUT'")).rows[0].n;
    assert.equal(mvs, 0);
    // Fridge unchanged
    const fi = (await pool.query('SELECT quantity FROM fridge_items WHERE id=$1', [fridgeId])).rows[0];
    assert.equal(Number(fi.quantity), 100);
  });

  // D10: COOK_OUT movement unit matches batch mutation
  await t.test('D10: COOK_OUT movement unit matches batch unit', async () => {
    const { sessionId } = await setupCookingSession();
    const fridgeId = randomUUID();
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,created_by_user_id)
      VALUES ($1,$2,$3,1,'kg','REFRIGERATED',$4)`, [fridgeId, family.id, ingPork, user.id]);
    await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, {
      consumption: [{ ingredient_id: ingPork, quantity: 500, unit_code: 'g' }],
    });
    const mv = (await pool.query("SELECT quantity_delta, unit_code FROM inventory_movements WHERE movement_type='COOK_OUT'")).rows[0];
    assert.equal(mv.unit_code, 'kg'); // batch is kg, movement must be kg
    assert.equal(Number(mv.quantity_delta), -0.5);
  });

  // D11: session -> COMPLETED, meal -> COMPLETED
  await t.test('D11: complete sets session and meal to COMPLETED', async () => {
    const { mealId, sessionId } = await setupCookingSession();
    const res = await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, { consumption: [] });
    assert.equal(res.status, 200);
    const sess = await request('GET', `/families/${family.id}/cooking-sessions/${sessionId}`);
    assert.equal(sess.body.data.status, 'COMPLETED');
    assert.equal(sess.body.data.meal.status, 'COMPLETED');
  });

  // D12: second complete -> 409, no double deduction
  await t.test('D12: idempotent — second complete returns 409', async () => {
    const { sessionId } = await setupCookingSession();
    const fridgeId = randomUUID();
    await pool.query(`INSERT INTO fridge_items(id,family_id,ingredient_id,quantity,unit_code,storage_location,created_by_user_id)
      VALUES ($1,$2,$3,1,'kg','REFRIGERATED',$4)`, [fridgeId, family.id, ingPork, user.id]);
    await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, {
      consumption: [{ ingredient_id: ingPork, quantity: 500, unit_code: 'g' }],
    });
    const second = await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, {
      consumption: [{ ingredient_id: ingPork, quantity: 100, unit_code: 'g' }],
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'SESSION_NOT_ACTIVE');
    // Only one movement
    const mvs = (await pool.query("SELECT COUNT(*)::int as n FROM inventory_movements WHERE movement_type='COOK_OUT'")).rows[0].n;
    assert.equal(mvs, 1);
  });

  // D13: empty consumption completes with no movements
  await t.test('D13: empty consumption completes without deduction', async () => {
    const { sessionId } = await setupCookingSession();
    const res = await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, { consumption: [] });
    assert.equal(res.status, 200);
    const mvs = (await pool.query("SELECT COUNT(*)::int as n FROM inventory_movements WHERE movement_type='COOK_OUT'")).rows[0].n;
    assert.equal(mvs, 0);
  });

  // D14: snapshot/live drift — completion candidates stay frozen
  await t.test('D14: completion candidates from snapshot, not live recipe', async () => {
    const { mealId, sessionId } = await setupCookingSession();
    // Modify live recipe after confirm
    await pool.query("UPDATE recipe_ingredients SET quantity=999 WHERE recipe_id=$1 AND ingredient_id=$2", [recipe, ingPork]);
    const sess = await request('GET', `/families/${family.id}/cooking-sessions/${sessionId}`);
    const pork = sess.body.data.consumption_candidates.find(c => c.ingredient_id === ingPork);
    assert.equal(pork.suggested_quantity, 500, 'should be frozen 500g, not live 999g');
  });

  // D15: completed history recipe identity stays frozen
  await t.test('D15: completed history shows frozen recipe name after live rename', async () => {
    const { mealId, sessionId } = await setupCookingSession();
    await request('POST', `/families/${family.id}/cooking-sessions/${sessionId}/complete`, { consumption: [] });
    // Rename live recipe
    await pool.query("UPDATE recipes SET name='新红烧肉' WHERE id=$1", [recipe]);
    const hist = await request('GET', `/families/${family.id}/meals/history?limit=10`);
    const meal = hist.body.data.find(m => m.id === mealId);
    assert.ok(meal, 'completed meal should be in history');
    assert.equal(meal.items[0].recipe_name, '红烧肉', 'history should show frozen name, not live rename');
  });
});
