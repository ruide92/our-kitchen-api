const test=require('node:test');
const assert=require('node:assert/strict');
const {createFamilyService}=require('../../backend/v1/family-service');
test('aggregate settings read holds shared family lock until all component reads complete',async()=>{
  const queries=[];
  const client={query:async(sql)=>{
    queries.push(sql);
    if(sql.startsWith('SELECT * FROM families')) { assert.match(sql,/FOR SHARE$/); return {rows:[{id:'family'}]}; }
    if(sql.includes('FROM family_members')) return {rows:[{role:'MEMBER'}]};
    if(sql.includes('FROM family_settings')) return {rows:[{version:1}]};
    return {rows:[]};
  },release(){}};
  assert.equal((await createFamilyService({connect:async()=>client}).getSettings('family','user')).version,1);
  assert.equal(queries.at(-1),'COMMIT');
});
