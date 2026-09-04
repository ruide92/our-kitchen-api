const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../../backend/v1/config');
const { createWechatClient } = require('../../backend/v1/wechat');
const { createTokens } = require('../../backend/v1/tokens');
const { withTransaction } = require('../../backend/v1/db');
const jwt = require('jsonwebtoken');

const env = () => ({ DATABASE_URL: 'postgres://localhost/kitchen_test', JWT_SECRET: 'test-only-'.repeat(8), WECHAT_APP_ID: 'wx-test', WECHAT_APP_SECRET: 'test-only-wechat', PORT: '3101' });

test('configuration rejects each missing credential without exposing values', () => {
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET']) {
    const input = env(); delete input[key];
    assert.throws(() => loadConfig(input), new RegExp(key));
  }
  assert.throws(() => loadConfig({ ...env(), JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.throws(() => loadConfig({ ...env(), PORT: 'NaN' }), /PORT/);
  assert.throws(() => loadConfig({ ...env(), DATABASE_URL: 'https://password@example.com' }), /DATABASE_URL/);
  assert.equal(loadConfig(env()).port, 3101);
});

test('old WeChat environment names cannot replace canonical names', () => {
  const input = { ...env(), WECHAT_APPID: 'legacy-id', WECHAT_SECRET: 'legacy-secret' };
  delete input.WECHAT_APP_ID;
  assert.throws(() => loadConfig(input), /WECHAT_APP_ID/);
  input.WECHAT_APP_ID = 'canonical-id'; delete input.WECHAT_APP_SECRET;
  assert.throws(() => loadConfig(input), /WECHAT_APP_SECRET/);
});

test('JWT binds subject, issuer, audience and algorithm', () => {
  const tokens = createTokens(env().JWT_SECRET);
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(tokens.verify(tokens.sign(id)), id);
  const wrong = jwt.sign({ sub: id }, env().JWT_SECRET, { issuer: 'other', audience: 'kitchen-mini', expiresIn: '1h' });
  assert.throws(() => tokens.verify(wrong));
  assert.throws(() => tokens.verify(jwt.sign({ sub: id }, env().JWT_SECRET, { algorithm: 'HS384' })));
  const expired = jwt.sign({ sub: id, exp: 1 }, env().JWT_SECRET, { issuer: 'kitchen-v1', audience: 'kitchen-mini' });
  assert.throws(() => tokens.verify(expired));
});

test('code2Session sends server credentials and only returns identity fields', async () => {
  let requested;
  const client = createWechatClient({ appid: 'wx-test', secret: 'test-secret', fetchImpl: async (url, options) => {
    requested = new URL(url);
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ openid: 'stable-id', unionid: 'union', session_key: 'must-not-leak' }) };
  } });
  assert.deepEqual(await client.exchange('code-A'), { openid: 'stable-id', unionid: 'union' });
  assert.equal(requested.origin, 'https://api.weixin.qq.com');
  assert.equal(requested.pathname, '/sns/jscode2session');
  assert.equal(requested.searchParams.get('js_code'), 'code-A');
  assert.equal(requested.searchParams.get('secret'), 'test-secret');
  assert.equal(requested.searchParams.get('grant_type'), 'authorization_code');
});

test('code2Session fails closed on upstream rejection, malformed identity or network failure', async () => {
  for (const body of [{ errcode: 40029, errmsg: 'invalid secret details' }, {}, { openid: 123 }]) {
    const client = createWechatClient({ appid: 'a', secret: 's', fetchImpl: async () => ({ ok: true, json: async () => body }) });
    await assert.rejects(client.exchange('x'), error => error.status === 401 && !error.message.includes('secret'));
  }
  const client = createWechatClient({ appid: 'a', secret: 's', fetchImpl: async () => { throw new Error('url-with-secret'); } });
  await assert.rejects(client.exchange('x'), error => error.status === 503 && !error.message.includes('secret'));
});

test('transaction commits or rolls back on the SAME checked-out client and always releases', async () => {
  for (const fail of [false, true]) {
    const commands = [];
    const client = { query: async sql => commands.push(sql), release: () => commands.push('RELEASE') };
    const pool = { connect: async () => client };
    const action = withTransaction(pool, async tx => { assert.equal(tx, client); await tx.query('WORK'); if (fail) throw new Error('abort'); return 42; });
    if (fail) await assert.rejects(action, /abort/); else assert.equal(await action, 42);
    assert.deepEqual(commands, ['BEGIN', 'WORK', fail ? 'ROLLBACK' : 'COMMIT', 'RELEASE']);
  }
});

test('rollback failure destroys connection while preserving original business error', async () => {
  const rollbackError = new Error('connection lost');
  const businessError = new Error('original failure');
  let releasedWith;
  const client = { query: async sql => { if (sql === 'ROLLBACK') throw rollbackError; }, release: error => { releasedWith = error; } };
  await assert.rejects(withTransaction({ connect: async () => client }, async () => { throw businessError; }), error => error === businessError);
  assert.equal(releasedWith, rollbackError);
});
