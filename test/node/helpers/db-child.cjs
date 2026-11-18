// node db-child.cjs <dbPath> <write|read|tables>: opens the built database on a SQLite file and does one thing.
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { registerNodeHost, dist } = require('./host.cjs');

const [dbPath, action] = process.argv.slice(2);

async function main() {
  registerNodeHost({ dbPath });
  const database = require(path.join(dist, 'database/index.js')).default;
  // The adapter sets itself up on first use, so one read waits for the open and any migration.
  await database.get('settings').query().fetch();
  const { getSetting, setSetting } = require(path.join(dist, 'database/services/setting-service.js'));

  if (action === 'write') {
    await setSetting('probe', '1');
    console.log('{}');
  } else if (action === 'read') {
    console.log(JSON.stringify(await getSetting('probe')));
  } else if (action === 'tables') {
    const raw = new DatabaseSync(dbPath, { readOnly: true });
    const names = raw.prepare("select name from sqlite_master where type = 'table' order by name").all().map((r) => r.name);
    const out = {};
    for (const name of names) {
      const columns = raw.prepare(`pragma table_info('${name}')`).all().map((c) => ({ name: c.name, type: c.type, notnull: c.notnull }));
      const indexes = raw.prepare(`pragma index_list('${name}')`).all().map((i) => i.name);
      out[name] = { columns, indexes };
    }
    raw.close();
    console.log(JSON.stringify(out));
  } else {
    throw new Error(`unknown action ${action}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
