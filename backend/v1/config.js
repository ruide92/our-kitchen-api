function loadConfig(env = process.env) {
  for (const key of ['DATABASE_URL', 'JWT_SECRET', 'WECHAT_APP_ID', 'WECHAT_APP_SECRET']) {
    if (typeof env[key] !== 'string' || !env[key].trim()) throw new Error(`Missing ${key}`);
  }
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('Invalid DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid DATABASE_URL');
  if (Buffer.byteLength(env.JWT_SECRET) < 32) throw new Error('JWT_SECRET requires at least 32 bytes');
  const port = Number(env.PORT || 3101);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  return Object.freeze({ databaseUrl: env.DATABASE_URL, jwtSecret: env.JWT_SECRET,
    wechatAppid: env.WECHAT_APP_ID, wechatSecret: env.WECHAT_APP_SECRET, port });
}
module.exports = { loadConfig };
