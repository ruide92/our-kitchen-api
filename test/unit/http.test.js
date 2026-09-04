const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../../backend/v1/app');
const { createTokens } = require('../../backend/v1/tokens');

async function harness(t) {
  const tokens = createTokens('test-only-signing-key-'.repeat(4));
  const user = { id: '11111111-1111-4111-8111-111111111111', nickname: null, avatar_url: null };
  const repo = { upsertWechatUser: async identity => { assert.equal(identity.openid, 'stable'); return user; }, getUser: async id => id === user.id ? user : null, listFamilies: async () => [], getMembership: async () => null };
  const app = createApp({ repo, tokens, wechat: { exchange: async () => ({ openid: 'stable', unionid: null }) } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (path, options = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
  return { repo, tokens, user, request };
}

test('v1 auth uses stable server identity and strips upstream secrets', async t => {
  const { request, user } = await harness(t);
  for (const code of ['code-A', 'code-B']) {
    const res = await request('/api/v1/auth/wechat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    assert.equal(res.status, 200);
    const body = await res.json(); assert.equal(body.data.user.id, user.id);
    assert.equal(typeof body.data.token, 'string'); assert.deepEqual(body.data.families, []);
    assert.equal(JSON.stringify(body).includes('openid'), false);
  }
});

test('missing token is 401; nonmember is 403; legacy routes do not exist in v1 app', async t => {
  const { request, tokens, user } = await harness(t);
  assert.equal((await request('/api/v1/me')).status, 401);
  const res = await request('/api/v1/families/22222222-2222-4222-8222-222222222222', { headers: { Authorization: `Bearer ${tokens.sign(user.id)}` } });
  assert.equal(res.status, 403); assert.equal((await res.json()).error.code, 'FAMILY_FORBIDDEN');
  assert.equal((await request('/api/auth/login', { method: 'POST' })).status, 404);
});

test('invalid JSON and wrong field contracts are 400, internal errors are redacted', async t => {
  const { request, repo } = await harness(t);
  const send = body => request('/api/v1/auth/wechat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  assert.equal((await send('{')).status, 400);
  assert.equal((await send(JSON.stringify({ code: 123 }))).status, 400);
  repo.upsertWechatUser = async () => { throw new Error('postgres://secret@host'); };
  const res = await send(JSON.stringify({ code: 'abc' }));
  assert.equal(res.status, 500); assert.equal((await res.text()).includes('secret'), false);
});
