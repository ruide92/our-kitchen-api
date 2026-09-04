const test=require('node:test');
const assert=require('node:assert/strict');
const {createMinePage}=require('../../miniprogram/pages/mine/mine-controller');
function harness(initial={status:'loading',user:null,families:[],active_family_id:null,activeFamily:null,members:[],settings:null,hasFamily:false,familyStatus:'idle'}) {
  let state=initial,listener;const actions=[],toasts=[],clipboard=[];
  const session={subscribe(fn){listener=fn;fn(state);return()=>{listener=null;}},getState:()=>state,
    refresh:async()=>state,createFamily:async name=>actions.push(['create',name]),joinFamily:async code=>actions.push(['join',code]),
    updateNickname:async name=>actions.push(['nickname',name]),selectFamily:async id=>actions.push(['select',id])};
  const app={getV1Session:()=>session,ensureSessionReady:async()=>state,retryV1Session:async()=>state};
  const wx={showToast:options=>toasts.push(options.title),setClipboardData:options=>{clipboard.push(options.data);options.success();}};
  const page=createMinePage({app,wxAdapter:wx});page.setData=values=>Object.assign(page.data,values);page.getTabBar=()=>({setData:()=>{}});page.onLoad();
  return {page,actions,toasts,clipboard,session,app,publish(value){state=value;if(listener)listener(state);}};
}
const account=()=>({status:'authenticated',user:{id:'u',nickname:null,avatar_url:null},families:[],active_family_id:null,activeFamily:null,members:[],settings:null,hasFamily:false,familyStatus:'idle'});
test('Mine starts loading and renders neutral no-family state, not fixture identity',async()=>{
  const h=harness();assert.equal(h.page.data.status,'loading');h.publish(account());await h.page.onShow();
  assert.equal(h.page.data.displayName,'微信用户');assert.equal(h.page.data.hasFamily,false);assert.equal(h.page.data.family,null);
  h.page.openCreateSheet();assert.equal(h.page.data.sheet,'create');h.page.setData({fieldText:' New name '});await h.page.submitFamily();assert.deepEqual(h.actions,[['create','New name']]);
});
test('Mine shows auth failure and retry instead of fake authenticated data',async()=>{
  const h=harness();h.app.ensureSessionReady=async()=>{throw new Error('offline');};
  h.publish({...account(),status:'authFailed',user:null,error:{message:'无法连接服务'}});await h.page.onShow();
  assert.equal(h.page.data.authenticated,false);assert.equal(h.page.data.family,null);
  let retried=false;h.app.retryV1Session=async()=>{retried=true;};await h.page.retryLogin();assert.equal(retried,true);
});
test('member names and read-only settings are derived from server shape',()=>{
  const state={...account(),hasFamily:true,active_family_id:'f',familyStatus:'ready',activeFamily:{id:'f',name:'Actual family',role:'ADMIN',invite_code:'ActualCode'},members:[{id:'m',role:'ADMIN',user:{id:'u',nickname:'Actual user',avatar_url:'https://example.com/a.png'}}],settings:{family_id:'f',default_diners:3,cookware:['WOK']}};
  const h=harness(state);assert.equal(h.page.data.family.role,'ADMIN');assert.equal(h.page.data.members[0].nickname,'Actual user');assert.equal(h.page.data.settings.default_diners,3);
  h.page.openInviteSheet();h.page.copyInviteCode();assert.deepEqual(h.clipboard,['ActualCode']);
  h.publish({...state,activeFamily:{...state.activeFamily,invite_code:null}});h.page.copyInviteCode();assert.equal(h.clipboard.length,1);
});
test('join preserves case; nickname saves through session; duplicate submit is blocked',async()=>{
  const h=harness(account());h.page.openJoinSheet();h.page.setData({fieldText:' AbCd '});await h.page.submitFamily();
  assert.deepEqual(h.actions,[['join','AbCd']]);
  h.page.openProfileSheet();h.page.setData({fieldText:' New Nick '});await h.page.saveProfile();assert.deepEqual(h.actions[1],['nickname','New Nick']);
  h.page.setData({busy:true,sheet:'join',fieldText:'x'});await h.page.submitFamily();assert.equal(h.actions.length,2);
});
test('family switch clears visible family sheets immediately and unsubscribe on unload',()=>{
  const h=harness({...account(),active_family_id:'f1',hasFamily:true,activeFamily:{id:'f1'},familyStatus:'ready'});
  h.page.openInviteSheet();h.publish({...account(),active_family_id:'f2',hasFamily:true,familyStatus:'loading'});
  assert.equal(h.page.data.sheet,'');assert.equal(h.page.data.family,null);assert.deepEqual(h.page.data.members,[]);
  h.page.onUnload();h.publish(account());assert.equal(h.page.data.active_family_id,'f2');
});
