const { ApiError } = require('./errors');
const { UUID } = require('./tokens');
const forbidden = () => new ApiError(403,'FAMILY_FORBIDDEN','你不是该家庭成员');
function assertRole(member, roles) {
  if (!member) throw forbidden();
  if (roles && !roles.includes(member.role)) throw new ApiError(403,'ROLE_FORBIDDEN','没有操作权限');
}
function requireFamilyMember(repo) {
  return (req,res,next) => {
    if (!UUID.test(req.params.family_id)) return next(new ApiError(400,'INVALID_REQUEST','家庭 ID 无效'));
    repo.getMembership(req.params.family_id,req.user.id).then(member=>{
      assertRole(member); req.membership=member; next();
    }).catch(next);
  };
}
function requireFamilyRole(...roles) {
  return (req,res,next) => { try { assertRole(req.membership,roles); next(); } catch(error) { next(error); } };
}
// Must be called after obtaining the family row lock inside every write transaction.
async function authorize(client,familyId,userId,roles) {
  const member=(await client.query("SELECT * FROM family_members WHERE family_id=$1 AND user_id=$2 AND status='ACTIVE'",[familyId,userId])).rows[0];
  assertRole(member,roles); return member;
}
module.exports={requireFamilyMember,requireFamilyRole,authorize,forbidden};
