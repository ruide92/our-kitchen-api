const test = require('node:test');
const assert = require('node:assert/strict');
const { createV1Api } = require('../../miniprogram/utils/v1-api');
const { createV1Session } = require('../../miniprogram/utils/v1-session');

// Test-only transport fixtures. Production modules never import these values.
function adapter(families = []) {
  const store = { token: 'legacy-token', userInfo: { name: 'legacy' }, kitchenInfo: { id: 'legacy' } };
  const calls = [];
  const user = { id: 'test-user', nickname: null, avatar_url: null };
  const wx = {
    store, calls, user, families, loginCount: 0,
    getSystemInfoSync: () => ({ platform: 'devtools' }),
    getStorageSync: key => store[key], setStorageSync: (key,value) => { store[key] = value; }, removeStorageSync: key => { delete store[key]; },
    login(options) { wx.loginCount++; options.success({ code: 'test-wx-code' }); },
    request(options) {
      calls.push(options);
      Promise.resolve().then(() => wx.respond(options)).then(value => options.success(value), () => options.fail({ errMsg: 'network failure' }));
    },
    respond(options) {
      const path = options.url.replace('https://test.example/api/v1', '');
      let data;
      if (path === '/auth/wechat') data = { token: 'v1-test-token', user, families: wx.families };
      else if (path === '/me') { if (options.method === 'PATCH') Object.assign(user, options.data); data = user; }
      else if (path === '/me/families') data = wx.families;
      else if (path === '/families' || path === '/families/join') {
        data = { id: 'new-family', name: 'New family', role: 'MEMBER', invite_code: 'server-code' };
        wx.families = [...wx.families, data];
      } else {
        const family = wx.families.find(f => path.startsWith(`/families/${f.id}`));
        if (!family) throw new Error('Unexpected endpoint');
        if (path.endsWith('/members')) data = [{ id: 'member', user_id: user.id, role: family.role, user: { ...user } }];
        else if (path.endsWith('/settings')) data = { family_id: family.id, default_diners: 2, cookware: [] };
        else data = { ...family, invite_code: 'server-code' };
      }
      return { statusCode: 200, data: { data, meta: {} } };
    }
  };
  return wx;
}
const make = wx => createV1Session({ wxAdapter: wx, baseUrl: 'https://test.example' });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('V1 client sends isolated Bearer token and unwraps data, preserving envelope metadata', async () => {
  const wx = adapter(); wx.store.v1_token = 'v1-only';
  const api = createV1Api({ wxAdapter: wx, baseUrl: 'https://test.example' });
  assert.deepEqual(await api.getMe(), wx.user);
  assert.equal(wx.calls[0].header.Authorization, 'Bearer v1-only');
  assert.deepEqual(await api.request('/me'), { data: wx.user, meta: {} });
});
test('401 clears V1 keys but preserves every legacy storage key', async () => {
  const wx = adapter(); Object.assign(wx.store, { v1_token: 'bad', v1_user: {}, v1_active_family_id: 'old' });
  wx.respond = () => ({ statusCode: 401, data: { error: { code: 'AUTH_REQUIRED', message: '重新登录', details: null } } });
  const api = createV1Api({ wxAdapter: wx, baseUrl: 'https://test.example' });
  await assert.rejects(api.getMe(), e => e.status === 401 && e.code === 'AUTH_REQUIRED');
  assert.equal(wx.store.v1_token, undefined); assert.equal(wx.store.v1_user, undefined); assert.equal(wx.store.v1_active_family_id, undefined);
  assert.equal(wx.store.token, 'legacy-token'); assert.deepEqual(wx.store.userInfo, { name: 'legacy' }); assert.deepEqual(wx.store.kitchenInfo, { id: 'legacy' });
});
test('late 401 from old token cannot clear a newly authenticated token', async () => {
  const wx = adapter(); wx.store.v1_token = 'old'; const pending = deferred();
  wx.respond = () => pending.promise;
  const api = createV1Api({ wxAdapter: wx, baseUrl: 'https://test.example' });
  const request = api.getMe(); wx.store.v1_token = 'new';
  pending.resolve({ statusCode: 401, data: { error: { code: 'AUTH_REQUIRED', message: 'expired' } } });
  await assert.rejects(request); assert.equal(wx.store.v1_token, 'new');
});
test('loopback is DevTools-only and malformed successes do not become fake data', async () => {
  const wx = adapter(); wx.getSystemInfoSync = () => ({ platform: 'ios' });
  const api = createV1Api({ wxAdapter: wx, baseUrl: 'http://127.0.0.1:3101' });
  await assert.rejects(api.getMe(), e => e.code === 'DEVTOOLS_ONLY'); assert.equal(wx.calls.length, 0);
  wx.respond = () => ({ statusCode: 200, data: { unexpected: 'shape' } });
  await assert.rejects(createV1Api({ wxAdapter: wx, baseUrl: 'https://test.example' }).getMe(), e => e.code === 'INVALID_RESPONSE');
});

for (const [label,families,saved,expected] of [
  ['zero',[],null,null],
  ['one',[{id:'f1',name:'One',role:'OWNER'}],null,'f1'],
  ['saved valid',[{id:'f1'},{id:'f2'}],'f2','f2'],
  ['saved invalid multi',[{id:'f1'},{id:'f2'}],'removed',null]
]) test(`bootstrap family selection: ${label}`, async () => {
  const wx = adapter(families); if (saved) wx.store.v1_active_family_id = saved;
  const session = make(wx); await session.ensureReady();
  assert.equal(session.getState().status,'authenticated'); assert.equal(session.getState().active_family_id, expected);
  assert.equal(session.getState().hasFamily, Boolean(expected)); assert.equal(wx.store.v1_token,'v1-test-token');
  assert.deepEqual(wx.store.v1_user,wx.user); assert.equal(wx.store.token,'legacy-token');
  assert.equal(wx.calls[0].url,'https://test.example/api/v1/auth/wechat');
  assert.equal(wx.calls[0].header.Authorization,undefined);
});
test('bootstrap is single-flight and pages await the same pending session', async () => {
  const wx = adapter(); let loginOptions; wx.login = options => { wx.loginCount++; loginOptions=options; };
  const session=make(wx); const a=session.ensureReady(); const b=session.ensureReady();
  assert.equal(a,b); assert.equal(session.getState().status,'loading'); assert.equal(wx.loginCount,1);
  loginOptions.success({code:'test'}); await Promise.all([a,b]); assert.equal(session.getState().status,'authenticated');
});
test('login failure is observable and only explicit retry calls wx.login again',async()=>{
  const wx=adapter(); wx.login=options=>{wx.loginCount++;options.fail({errMsg:'failure'});};
  const session=make(wx); await assert.rejects(session.ensureReady());
  assert.equal(session.getState().status,'authFailed'); await assert.rejects(session.ensureReady()); assert.equal(wx.loginCount,1);
  await assert.rejects(session.retry()); assert.equal(wx.loginCount,2);
});
test('create and join update active family using server data and exact request fields',async()=>{
  for(const mode of ['createFamily','joinFamily']) {
    const wx=adapter(); const session=make(wx); await session.ensureReady();
    await session[mode](mode==='joinFamily'?' AbCd ':' New family ');
    assert.equal(session.getState().active_family_id,'new-family'); assert.equal(wx.store.v1_active_family_id,'new-family');
    assert.equal(session.getState().activeFamily.invite_code,'server-code'); assert.equal(session.getState().members.length,1);
    const call=wx.calls.find(c=>c.url.endsWith(mode==='joinFamily'?'/families/join':'/families'));
    assert.deepEqual(call.data,mode==='joinFamily'?{invite_code:'AbCd'}:{name:'New family'});
  }
});
test('nickname PATCH updates session and refetches server member names',async()=>{
  const wx=adapter([{id:'f1',name:'One',role:'OWNER'}]); const session=make(wx); await session.ensureReady();
  await session.updateNickname(' New name ');
  assert.equal(session.getState().user.nickname,'New name'); assert.equal(wx.store.v1_user.nickname,'New name');
  assert.equal(session.getState().members[0].user.nickname,'New name');
  assert.deepEqual(wx.calls.find(c=>c.method==='PATCH').data,{nickname:'New name'});
});
test('late family responses never overwrite a newly selected family',async()=>{
  const wx=adapter([{id:'f1',name:'One'},{id:'f2',name:'Two'}]); const session=make(wx); await session.ensureReady();
  const original=wx.respond;const pending=deferred();
  wx.respond=options=>options.url.includes('/families/f1')?pending.promise.then(()=>original(options)):original(options);
  const first=session.selectFamily('f1');await session.selectFamily('f2');pending.resolve();await first;
  assert.equal(session.getState().activeFamily.id,'f2');assert.equal(session.getState().settings.family_id,'f2');
});
test('401 invalidates in-memory session without an automatic relogin loop',async()=>{
  const wx=adapter([{id:'f1',name:'One'}]);const session=make(wx);await session.ensureReady();
  wx.respond=()=>({statusCode:401,data:{error:{code:'AUTH_REQUIRED',message:'登录已过期'}}});
  await assert.rejects(session.refresh());
  assert.equal(session.getState().status,'authFailed');assert.equal(session.getState().user,null);assert.equal(session.getState().activeFamily,null);assert.equal(wx.loginCount,1);
});
test('failed follow-up from a completed creation cannot poison a later selected family',async()=>{
  const wx=adapter([{id:'f1',name:'One'}]);const session=make(wx);await session.ensureReady();
  const original=wx.respond, pending=deferred(), reached=deferred();
  wx.respond=options=>{
    if(options.url.endsWith('/me/families')){reached.resolve();return pending.promise;}
    return original(options);
  };
  const creating=session.createFamily('New');await reached.promise;
  await session.selectFamily('f1');
  pending.resolve({statusCode:500,data:{error:{code:'INTERNAL_ERROR',message:'Old follow-up failed'}}});
  await assert.rejects(creating);
  assert.equal(session.getState().activeFamily.id,'f1');assert.equal(session.getState().familyStatus,'ready');assert.equal(session.getState().familyError,null);
});
test('an older onShow refresh cannot undo a newly created active family',async()=>{
  const wx=adapter([{id:'f1',name:'One'}]);const session=make(wx);await session.ensureReady();
  const original=wx.respond,pending=deferred(),reached=deferred();let paused=false;
  wx.respond=options=>{
    if(options.url.endsWith('/me/families')&&!paused){paused=true;const old=original(options);reached.resolve();return pending.promise.then(()=>old);}
    return original(options);
  };
  const refreshing=session.refresh();await reached.promise;
  await session.createFamily('New');pending.resolve();await refreshing;
  assert.equal(session.getState().active_family_id,'new-family');assert.equal(session.getState().activeFamily.id,'new-family');
});
test('refresh started during nickname PATCH cannot overwrite its committed result',async()=>{
  const wx=adapter();const session=make(wx);await session.ensureReady();
  const original=wx.respond,patchGate=deferred(),patchReached=deferred(),getGate=deferred(),getReached=deferred();
  wx.respond=options=>{
    if(options.method==='PATCH'){patchReached.resolve();return patchGate.promise.then(()=>original(options));}
    if(options.url.endsWith('/me')){const captured=JSON.parse(JSON.stringify(original(options)));getReached.resolve();return getGate.promise.then(()=>captured);}
    return original(options);
  };
  const patching=session.updateNickname('New name');await patchReached.promise;
  const refreshing=session.refresh();await getReached.promise;
  patchGate.resolve();await patching;getGate.resolve();await refreshing;
  assert.equal(session.getState().user.nickname,'New name');assert.equal(wx.store.v1_user.nickname,'New name');
});
