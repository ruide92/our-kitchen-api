const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFamilyCreate, validateJoin, validateFamilyPatch, validateSettingsPatch, validateMemberPatch, validateProfile } = require('../../backend/v1/family-validation');

test('family and join validation reject aliases and spoofed ownership', () => {
  assert.deepEqual(validateFamilyCreate({name:' Test '}),{name:'Test'});
  for (const value of [null,[],{name:' '},{name:'ok',user_id:'spoof'}]) assert.throws(()=>validateFamilyCreate(value));
  assert.deepEqual(validateJoin({invite_code:'ABC123'}),{invite_code:'ABC123'});
  for (const value of [{code:'ABC123'},{inviteCode:'ABC123'},{invite_code:''}]) assert.throws(()=>validateJoin(value));
});
test('writes require integer version and strict allowed fields', () => {
  assert.throws(()=>validateFamilyPatch({name:'x'}));
  assert.throws(()=>validateFamilyPatch({version:'1',name:'x'}));
  assert.throws(()=>validateSettingsPatch({version:1,default_diners:0}));
  assert.throws(()=>validateSettingsPatch({version:1,cookware:['WOK','WOK']}));
  assert.throws(()=>validateMemberPatch({role:'ADMIN',status:'REMOVED'}));
  assert.throws(()=>validateMemberPatch({role:'owner'}));
  assert.deepEqual(validateMemberPatch({status:'REMOVED'}),{status:'REMOVED'});
  assert.throws(()=>validateProfile({wechat_openid:'x'}));
  assert.throws(()=>validateProfile({avatar_url:'file:///secret'}));
  assert.deepEqual(validateProfile({nickname:null,avatar_url:null}),{nickname:null,avatar_url:null});
});
