const path = require('node:path');
const { Pool } = require('pg');
const { loadMigrations, migrate } = require('./migrations');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try { await migrate(pool, await loadMigrations(path.join(__dirname, 'sql'))); console.log('Core migrations applied'); }
  finally { await pool.end(); }
}
main().catch(() => { console.error('Migration failed; database details redacted'); process.exitCode = 1; });
