const { Pool } = require('pg');
const { loadConfig } = require('./config');
const { createTokens } = require('./tokens');
const { createWechatClient } = require('./wechat');
const { createRepository } = require('./repository');
const { createApp } = require('./app');
const { createFamilyService } = require('./family-service');

async function start() {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000, max: 10 });
  pool.on('error', () => console.error('PostgreSQL pool connection error'));
  try { await pool.query('SELECT 1'); }
  catch { await pool.end(); throw new Error('Database unavailable; v1 not started'); }
  const app = createApp({ repo: createRepository(pool), families: createFamilyService(pool), tokens: createTokens(config.jwtSecret),
    wechat: createWechatClient({ appid: config.wechatAppid, secret: config.wechatSecret }) });
  const server = app.listen(config.port, () => console.log(`Kitchen v1 listening on ${config.port}`));
  server.on('error', async () => { await pool.end(); process.exitCode = 1; });
  const close = () => server.close(() => pool.end().catch(() => { process.exitCode = 1; }));
  process.once('SIGTERM', close); process.once('SIGINT', close);
}
if (require.main === module) start().catch(() => { console.error('V1 startup failed: check configuration, database and migrations'); process.exitCode = 1; });
module.exports = { start };
