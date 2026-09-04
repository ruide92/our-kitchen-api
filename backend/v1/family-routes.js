const express=require('express');
const {requireFamilyMember,requireFamilyRole}=require('./family-access');
const {ApiError}=require('./errors');
const {UUID}=require('./tokens');
const route=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(next);
const ok=(res,data,status=200)=>res.status(status).json({data,meta:{}});

function installFamilyRoutes(app,repo,families) {
  app.post('/api/v1/families',route(async(req,res)=>ok(res,await families.create(req.user.id,req.body),201)));
  app.post('/api/v1/families/join',route(async(req,res)=>ok(res,await families.join(req.user.id,req.body))));
  const router=express.Router({mergeParams:true});
  router.get('/',route(async(req,res)=>ok(res,await families.getFamily(req.params.family_id,req.user.id))));
  router.patch('/',requireFamilyRole('OWNER','ADMIN'),route(async(req,res)=>ok(res,await families.updateFamily(req.params.family_id,req.user.id,req.body))));
  router.get('/members',route(async(req,res)=>ok(res,await families.listMembers(req.params.family_id,req.user.id))));
  router.patch('/members/:member_id',requireFamilyRole('OWNER'),route(async(req,res)=>{
    if (!UUID.test(req.params.member_id)) throw new ApiError(400,'INVALID_REQUEST','成员 ID 无效');
    ok(res,await families.updateMember(req.params.family_id,req.user.id,req.params.member_id,req.body));
  }));
  router.post('/invite-code/rotate',requireFamilyRole('OWNER','ADMIN'),route(async(req,res)=>{
    if (req.body && Object.keys(req.body).length) throw new ApiError(400,'INVALID_REQUEST','此操作不接受请求字段');
    ok(res,await families.rotateInvite(req.params.family_id,req.user.id));
  }));
  router.get('/settings',route(async(req,res)=>ok(res,await families.getSettings(req.params.family_id,req.user.id))));
  router.patch('/settings',requireFamilyRole('OWNER','ADMIN'),route(async(req,res)=>ok(res,await families.updateSettings(req.params.family_id,req.user.id,req.body))));
  app.use('/api/v1/families/:family_id',requireFamilyMember(repo),router);
}
module.exports={installFamilyRoutes};
