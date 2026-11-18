// A failing apply on a real SQLite file leaves every table exactly as it was.
// Run through `npm run check:node`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { registerNodeHost, dist } = require('./helpers/host.cjs');

test('an apply that SQLite refuses part way changes no table', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-apply-'));
  const dbPath = path.join(dir, 'app.db');
  try {
    registerNodeHost({ dbPath });
    const database = require(path.join(dist, 'database/index.js')).default;
    const { applySnapshot } = require(path.join(dist, 'sync/apply.js'));
    const schema = require(path.join(dist, 'database/schema.js')).default;
    await database.get('settings').query().fetch();

    const raw = new DatabaseSync(dbPath);
    const insert = (table, id, extra) =>
      raw.exec(`insert into ${table} (id, _status, _changed, ${extra.cols}) values ('${id}', '${extra.status ?? 'synced'}', '', ${extra.vals})`);
    insert('facts', 'f1', { cols: 'statement, created_at, updated_at', vals: "'old', 1, 1" });
    insert('facts', 'f2', { cols: 'statement, created_at, updated_at', vals: "'keep', 1, 1" });
    insert('topics', 't1', { cols: "text, normalized_text, weight, status, provenance, high_priority, created_at, updated_at", vals: "'t', 't', 1, 'a', 'p', 0, 1, 1" });
    // A row marked deleted is invisible to a query, but its id is still taken.
    insert('topics', 'ghost', { status: 'deleted', cols: "text, normalized_text, weight, status, provenance, high_priority, created_at, updated_at", vals: "'g', 'g', 1, 'a', 'p', 0, 1, 1" });

    const dump = () => ({
      facts: raw.prepare('select * from facts order by id').all(),
      topics: raw.prepare('select * from topics order by id').all(),
    });
    const before = JSON.stringify(dump());

    const topic = (id) => ({ id, text: 'x', normalized_text: 'x', weight: 1, status: 'a', provenance: 'p', high_priority: false, created_at: 1, updated_at: 1 });
    const snapshot = {
      schemaVersion: schema.version,
      registry: 1,
      tables: {
        facts: { hash: 'a', mode: 'replace', rows: [{ id: 'f1', statement: 'new', created_at: 1, updated_at: 2 }] },
        topics: { hash: 'b', mode: 'replace', rows: [topic('t1'), topic('ghost')] },
      },
    };

    await assert.rejects(applySnapshot(snapshot, { local: { schemaVersion: schema.version, registry: 1 } }));
    assert.equal(JSON.stringify(dump()), before);
    raw.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
