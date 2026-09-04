const { randomUUID, randomBytes } = require('node:crypto');
const { withTransaction } = require('./db');
const { ApiError } = require('./errors');
const { authorize, forbidden } = require('./family-access');
const validation = require('./family-validation');
const maintainers=['OWNER','ADMIN'];
const inviteCode=()=>randomBytes(8).toString('hex').toUpperCase();
const conflict=()=>new ApiError(409,'VERSION_CONFLICT','版本已更新，请刷新');

function createFamilyService(pool) {
  async function access(familyId,userId,roles,write,work) {
    return withTransaction(pool,async tx=>{
      const family=(await tx.query(`SELECT * FROM families WHERE id=$1 AND deleted_at IS NULL${write?' FOR UPDATE':' FOR SHARE'}`,[familyId])).rows[0];
      if (!family) throw forbidden();
      const member=await authorize(tx,familyId,userId,roles);
      return work(tx,family,member);
    });
  }
  async function settings(tx,familyId) {
    const row=(await tx.query('SELECT * FROM family_settings WHERE family_id=$1',[familyId])).rows[0];
    const cookware=(await tx.query('SELECT cookware_code FROM family_cookware WHERE family_id=$1 ORDER BY cookware_code',[familyId])).rows.map(x=>x.cookware_code);
    return {...row,cookware};
  }
  async function view(tx,family,member) { return {...family,role:member.role,settings:await settings(tx,family.id)}; }
  async function update(tx,table,idField,id,data,fields) {
    const keys=fields.filter(key=>key in data);
    const values=keys.map(key=>data[key]);
    // All identifiers originate in module-local whitelists, never request keys.
    const set=keys.map((key,index)=>`${key}=$${index+1}`);
    set.push('version=version+1','updated_at=now()'); values.push(id,data.version);
    const result=await tx.query(`UPDATE ${table} SET ${set.join(',')} WHERE ${idField}=$${values.length-1} AND version=$${values.length} RETURNING *`,values);
    if (!result.rows[0]) throw conflict(); return result.rows[0];
  }
  return {
    async create(userId,body) {
      const data=validation.validateFamilyCreate(body);
      return withTransaction(pool,async tx=>{
        const family=(await tx.query('INSERT INTO families(id,name,invite_code,created_by_user_id) VALUES($1,$2,$3,$4) RETURNING *',[randomUUID(),data.name,inviteCode(),userId])).rows[0];
        const member=(await tx.query("INSERT INTO family_members(id,family_id,user_id,role) VALUES($1,$2,$3,'OWNER') RETURNING *",[randomUUID(),family.id,userId])).rows[0];
        await tx.query('INSERT INTO family_settings(family_id) VALUES($1)',[family.id]);
        return view(tx,family,member);
      });
    },
    async join(userId,body) {
      const data=validation.validateJoin(body);
      return withTransaction(pool,async tx=>{
        const family=(await tx.query('SELECT * FROM families WHERE invite_code=$1 AND deleted_at IS NULL FOR UPDATE',[data.invite_code])).rows[0];
        if (!family) throw new ApiError(422,'INVALID_INVITE','邀请码无效');
        let member=(await tx.query('SELECT * FROM family_members WHERE family_id=$1 AND user_id=$2',[family.id,userId])).rows[0];
        if (member?.status==='REMOVED') throw forbidden();
        if (!member) member=(await tx.query("INSERT INTO family_members(id,family_id,user_id) VALUES($1,$2,$3) RETURNING *",[randomUUID(),family.id,userId])).rows[0];
        else if (member.status==='LEFT') member=(await tx.query("UPDATE family_members SET status='ACTIVE',role='MEMBER',joined_at=now(),updated_at=now() WHERE id=$1 RETURNING *",[member.id])).rows[0];
        return view(tx,family,member);
      });
    },
    getFamily(familyId,userId) { return access(familyId,userId,null,false,(tx,family,member)=>view(tx,family,member)); },
    listMembers(familyId,userId) {
      return access(familyId,userId,null,false,async tx=>(await tx.query(`SELECT m.id,m.family_id,m.user_id,m.role,m.status,m.joined_at,m.updated_at,
        json_build_object('id',u.id,'nickname',u.nickname,'avatar_url',u.avatar_url) AS "user"
        FROM family_members m JOIN users u ON u.id=m.user_id WHERE m.family_id=$1 AND m.status='ACTIVE' ORDER BY m.joined_at,m.id`,[familyId])).rows);
    },
    updateFamily(familyId,userId,body) {
      const data=validation.validateFamilyPatch(body);
      return access(familyId,userId,maintainers,true,async(tx,family,member)=>view(tx,await update(tx,'families','id',family.id,data,['name','photo_url','header_mode']),member));
    },
    getSettings(familyId,userId) { return access(familyId,userId,null,false,tx=>settings(tx,familyId)); },
    updateSettings(familyId,userId,body) {
      const data=validation.validateSettingsPatch(body);
      return access(familyId,userId,maintainers,true,async tx=>{
        await update(tx,'family_settings','family_id',familyId,data,validation.settingFields);
        if ('cookware' in data) {
          await tx.query('DELETE FROM family_cookware WHERE family_id=$1',[familyId]);
          for (const code of data.cookware) await tx.query('INSERT INTO family_cookware(family_id,cookware_code) VALUES($1,$2)',[familyId,code]);
        }
        return settings(tx,familyId);
      });
    },
    rotateInvite(familyId,userId) {
      return access(familyId,userId,maintainers,true,async tx=>(await tx.query('UPDATE families SET invite_code=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING invite_code,version',[inviteCode(),familyId])).rows[0]);
    },
    updateMember(familyId,userId,memberId,body) {
      const data=validation.validateMemberPatch(body);
      return access(familyId,userId,['OWNER'],true,async tx=>{
        const target=(await tx.query("SELECT * FROM family_members WHERE id=$1 AND family_id=$2 AND status='ACTIVE'",[memberId,familyId])).rows[0];
        if (!target) throw new ApiError(404,'NOT_FOUND','成员不存在');
        if (target.role==='OWNER' && (data.status==='REMOVED' || (data.role && data.role!=='OWNER'))) {
          const owners=(await tx.query("SELECT count(*)::int AS n FROM family_members WHERE family_id=$1 AND role='OWNER' AND status='ACTIVE'",[familyId])).rows[0].n;
          if (owners<=1) throw new ApiError(409,'LAST_OWNER','不能移除或降级最后一个 OWNER');
        }
        return (await tx.query('UPDATE family_members SET role=$1,status=$2,updated_at=now() WHERE id=$3 AND family_id=$4 RETURNING *',[data.role||target.role,data.status||target.status,memberId,familyId])).rows[0];
      });
    }
  };
}
module.exports={createFamilyService};
