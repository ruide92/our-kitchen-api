const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { withTransaction } = require('./db');

async function loadMigrations(directory) {
  const names = (await fs.readdir(directory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  return Promise.all(names.map(async name => {
    const sql = (await fs.readFile(path.join(directory, name), 'utf8')).replace(/\r\n/g, '\n');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

async function migrate(pool, migrations) {
  return withTransaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(73462001)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Map((await client.query('SELECT name, checksum FROM schema_migrations')).rows.map(row => [row.name, row.checksum]));
    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        if (applied.get(migration.name) !== migration.checksum) throw new Error(`Migration checksum mismatch: ${migration.name}`);
        continue;
      }
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [migration.name, migration.checksum]);
    }
  });
}
module.exports = { loadMigrations, migrate };
