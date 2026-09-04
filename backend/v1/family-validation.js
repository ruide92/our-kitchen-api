const { ApiError } = require('./errors');
const invalid = () => { throw new ApiError(400,'INVALID_REQUEST','请求字段无效'); };
function shape(body, allowed) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || !Object.keys(body).length || Object.keys(body).some(k=>!allowed.includes(k))) invalid();
  return { ...body };
}
function text(value, max, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid();
  return value.trim();
}
function integer(value, min = 1) { if (!Number.isInteger(value) || value < min || value > 2147483647) invalid(); return value; }
function url(value) {
  if (value === null) return null;
  text(value,2048);
  try { const parsed = new URL(value); if (parsed.protocol !== 'https:' || parsed.username || parsed.password) invalid(); }
  catch { invalid(); }
  return value;
}
function validateFamilyCreate(body) { const data=shape(body,['name']); data.name=text(data.name,80); return data; }
function validateJoin(body) { const data=shape(body,['invite_code']); data.invite_code=text(data.invite_code,128); return data; }
function validateFamilyPatch(body) {
  const data=shape(body,['version','name','photo_url','header_mode']); integer(data.version);
  if (Object.keys(data).length < 2) invalid();
  if ('name' in data) data.name=text(data.name,80);
  if ('photo_url' in data) data.photo_url=url(data.photo_url);
  if ('header_mode' in data && !['PHOTO','DUAL_AVATAR'].includes(data.header_mode)) invalid();
  return data;
}
const settingFields=['default_diners','breakfast_target_count','lunch_target_count','dinner_target_count','default_spiciness','repeat_strong_days','repeat_penalty_days','repeat_recover_days','random_default_mode','prefer_expiring_inventory'];
function validateSettingsPatch(body) {
  const data=shape(body,['version',...settingFields,'cookware']); integer(data.version);
  if (Object.keys(data).length < 2) invalid();
  for (const field of ['default_diners','breakfast_target_count','lunch_target_count','dinner_target_count']) if (field in data) integer(data[field]);
  for (const field of ['repeat_strong_days','repeat_penalty_days','repeat_recover_days']) if (field in data) integer(data[field],0);
  if ('default_spiciness' in data && data.default_spiciness !== null) { integer(data.default_spiciness,0); if (data.default_spiciness>5) invalid(); }
  if ('random_default_mode' in data && !['BALANCED','USE_INVENTORY','TRY_DIFFERENT'].includes(data.random_default_mode)) invalid();
  if ('prefer_expiring_inventory' in data && typeof data.prefer_expiring_inventory !== 'boolean') invalid();
  if ('cookware' in data && (!Array.isArray(data.cookware) || data.cookware.length>50 || new Set(data.cookware).size!==data.cookware.length || data.cookware.some(code=>typeof code!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(code)))) invalid();
  return data;
}
function validateMemberPatch(body) {
  const data=shape(body,['role','status']);
  if (Object.keys(data).length !== 1) invalid();
  if ('role' in data && !['OWNER','ADMIN','MEMBER'].includes(data.role)) invalid();
  if ('status' in data && data.status!=='REMOVED') invalid();
  return data;
}
function validateProfile(body) {
  const data=shape(body,['nickname','avatar_url']);
  if ('nickname' in data) data.nickname=text(data.nickname,80,true);
  if ('avatar_url' in data) data.avatar_url=url(data.avatar_url);
  return data;
}
module.exports={validateFamilyCreate,validateJoin,validateFamilyPatch,validateSettingsPatch,validateMemberPatch,validateProfile,settingFields};
