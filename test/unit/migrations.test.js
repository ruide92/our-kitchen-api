const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { loadMigrations, migrate } = require('../../backend/v1/migrations');

test('migration loader produces ordered SHA256 records for core schema', async () => {
  const migrations = await loadMigrations(path.join(__dirname, '../../backend/v1/sql'));
  assert.equal(migrations[0].name, '001_identity_family.sql');
  assert.match(migrations[0].checksum, /^[a-f0-9]{64}$/);
  assert.match(migrations[0].sql, /CREATE TABLE users/);
});

test('migration checksum is stable across Windows and Linux line endings', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kitchen-migration-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, '001_test.sql');
  await fs.writeFile(file, 'SELECT 1;\r\nSELECT 2;\r\n');
  const windows = await loadMigrations(directory);
  await fs.writeFile(file, 'SELECT 1;\nSELECT 2;\n');
  const linux = await loadMigrations(directory);
  assert.equal(windows[0].checksum, linux[0].checksum);
});

test('migration replay skips applied SQL and rejects checksum drift with rollback', async () => {
  for (const checksum of ['same', 'different']) {
    const commands = [];
    const client = { query: async (sql) => { commands.push(sql); return { rows: sql.startsWith('SELECT name') ? [{ name: '001.sql', checksum }] : [] }; }, release() {} };
    const run = migrate({ connect: async () => client }, [{ name: '001.sql', checksum: 'same', sql: 'ALTER SOMETHING' }]);
    if (checksum === 'same') await run; else await assert.rejects(run, /checksum/i);
    assert.equal(commands.includes('ALTER SOMETHING'), false);
    assert.equal(commands.at(-1), checksum === 'same' ? 'COMMIT' : 'ROLLBACK');
    assert.ok(commands.some(sql => sql.includes('pg_advisory_xact_lock')));
  }
});
