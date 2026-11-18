// The built database on a real SQLite file under Node, with the real schema and migrations.
// Run through `npm run check:node`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { appSchema, tableSchema } = require('@nozbe/watermelondb');
const { encodeSchema } = require('@nozbe/watermelondb/adapters/sqlite/encodeSchema');

const dist = path.resolve(__dirname, '../../dist/lib');
const child = path.join(__dirname, 'helpers/db-child.cjs');
const schema = require(path.join(dist, 'database/schema.js')).default;
const migrations = require(path.join(dist, 'database/migrations.js')).default.sortedMigrations;

// Tables that a data step of an old migration touches before any step creates them, so a database
// rebuilt at version 1 needs an empty stand-in for the step to run. Each is dropped again by a later step.
const OLD_TABLES_TOUCHED_BEFORE_CREATION = {
  cluster_suggestions: { columns: 'id text', why: 'columns added at versions 4 to 7 and emptied at 7, dropped at 8' },
  user_topics: { columns: 'id text, user_persona_id text, server_id text', why: 'filtered by owner at version 28, dropped at 30' },
  fact_topic_links: { columns: 'id text, server_topic_id text', why: 'filtered by topic at version 28, dropped at 30' },
};
// Columns that schema.ts no longer lists but an upgraded file keeps, because SQLite never drops them.
// One is read by a data step of an old migration, so a rebuilt version 1 file gets it back first.
const LEFTOVER_COLUMNS = {
  user_personas: { mera_protocol_enabled: 'in the first schema, read at version 11 to fill processing_mode' },
  tracked_stories: { latest_title: 'added at version 39, cleared at version 53' },
};
// Tables allowed in an upgraded file beyond the ones schema.ts lists.
const ALLOWED_EXTRA_TABLES = [];

function inTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-node-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(dbPath, action) {
  const out = execFileSync(process.execPath, [child, dbPath, action], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(out.trim().split('\n').pop());
}

// The schema as it stood at `version`: no table or column that a later migration adds.
function schemaAt(version, { withStubs }) {
  const later = migrations.filter((m) => m.toVersion > version).flatMap((m) => m.steps);
  const created = new Set(later.filter((s) => s.type === 'create_table').map((s) => s.schema.name));
  const added = {};
  for (const step of later.filter((s) => s.type === 'add_columns')) {
    (added[step.table] ??= new Set());
    for (const column of step.columns) added[step.table].add(column.name);
  }
  const tables = Object.values(schema.tables)
    .filter((table) => !created.has(table.name))
    .map((table) =>
      tableSchema({ name: table.name, columns: table.columnArray.filter((c) => !added[table.name]?.has(c.name)) }),
    );
  const stubs = withStubs ? Object.entries(OLD_TABLES_TOUCHED_BEFORE_CREATION) : [];
  return { sql: encodeSchema(appSchema({ version, tables })), stubs };
}

function writeOldFile(dbPath, version, { withStubs = false, rows = [] } = {}) {
  const { sql, stubs } = schemaAt(version, { withStubs });
  const raw = new DatabaseSync(dbPath);
  raw.exec(sql);
  if (withStubs) {
    for (const column of Object.keys(LEFTOVER_COLUMNS.user_personas)) {
      raw.exec(`alter table "user_personas" add column "${column}" integer`);
    }
  }
  for (const [name, { columns }] of stubs) raw.exec(`create table "${name}" (${columns})`);
  for (const row of rows) raw.exec(row);
  raw.exec(`pragma user_version = ${version}`);
  raw.close();
}

test('WatermelonDB resolves its SQLite driver to the node:sqlite package', () => {
  const watermelon = path.dirname(require.resolve('@nozbe/watermelondb/package.json'));
  const resolved = fs.realpathSync(require.resolve('better-sqlite3', { paths: [watermelon] }));
  assert.equal(resolved, fs.realpathSync(path.resolve(__dirname, '../../node/sqlite-driver/index.js')));
});

test('a written row survives a new process opening the same file', () => {
  inTempDir((dir) => {
    const dbPath = path.join(dir, 'app.db');
    run(dbPath, 'write');
    assert.equal(run(dbPath, 'read'), '1');
  });
});

test('a fresh file and a file upgraded from version 1 have the same tables, columns and indexes', () => {
  inTempDir((dir) => {
    const fresh = path.join(dir, 'fresh.db');
    const upgraded = path.join(dir, 'upgraded.db');
    run(fresh, 'tables');
    writeOldFile(upgraded, 1, { withStubs: true });
    const freshTables = run(fresh, 'tables');
    const upgradedTables = run(upgraded, 'tables');

    const sortColumns = (columns, table) =>
      columns.filter((c) => !LEFTOVER_COLUMNS[table]?.[c.name]).sort((a, b) => a.name.localeCompare(b.name));
    const sortNames = (names) => [...names].sort();
    for (const name of Object.keys(schema.tables)) {
      assert.ok(upgradedTables[name], `${name} missing after the upgrade`);
      assert.deepEqual(sortColumns(upgradedTables[name].columns, name), sortColumns(freshTables[name].columns, name), `${name} columns`);
      assert.deepEqual(sortNames(upgradedTables[name].indexes), sortNames(freshTables[name].indexes), `${name} indexes`);
    }
    const known = new Set([...Object.keys(schema.tables), 'local_storage', ...ALLOWED_EXTRA_TABLES]);
    assert.deepEqual(Object.keys(upgradedTables).filter((name) => !known.has(name)), []);
  });
});

test('rows survive the last two migrations and the new columns are null', () => {
  inTempDir((dir) => {
    const dbPath = path.join(dir, 'v56.db');
    writeOldFile(dbPath, 56, {
      rows: [
        "insert into article_suggestions (id, _status, _changed, article_id, status) values ('a1', 'synced', '', 'art-1', 'unscored')",
        "insert into saved_article_suggestions (id, _status, _changed, article_id) values ('s1', 'synced', '', 'art-2')",
      ],
    });
    run(dbPath, 'read');
    const raw = new DatabaseSync(dbPath, { readOnly: true });
    const article = raw.prepare("select article_id, score_failed_at from article_suggestions where id = 'a1'").get();
    const saved = raw.prepare("select article_id, archived from saved_article_suggestions where id = 's1'").get();
    raw.close();
    assert.equal(article.article_id, 'art-1');
    assert.equal(article.score_failed_at, null);
    assert.equal(saved.article_id, 'art-2');
    assert.equal(saved.archived, null);
  });
});

test('a file with a newer schema version than the code is emptied when the code opens it, so a host must check first', () => {
  inTempDir((dir) => {
    const dbPath = path.join(dir, 'newer.db');
    writeOldFile(dbPath, schema.version, {
      rows: ["insert into settings (id, _status, _changed, key, value) values ('k1', 'synced', '', 'probe', '1')"],
    });
    const raw = new DatabaseSync(dbPath);
    raw.exec(`pragma user_version = ${schema.version + 1}`);
    raw.close();
    assert.equal(run(dbPath, 'read'), null);
  });
});
