// The part of the better-sqlite3 API that WatermelonDB's Node driver calls, on Node's built-in SQLite.
const { DatabaseSync } = require('node:sqlite');

class Database {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.open = true;
    this.memory = path === ':memory:';
    if (!this.memory) {
      // WAL lets a second process read while one writes, the timeout waits on a held lock.
      this.db.exec('pragma journal_mode = WAL');
      this.db.exec('pragma busy_timeout = 5000');
    }
  }

  prepare(sql) {
    const statement = this.db.prepare(sql);
    return {
      run: (args = []) => statement.run(...args),
      get: (args = []) => statement.get(...args),
      all: (args = []) => statement.all(...args),
    };
  }

  exec(sql) {
    this.db.exec(sql);
  }

  transaction(fn) {
    return () => {
      this.db.exec('begin');
      try {
        const result = fn();
        this.db.exec('commit');
        return result;
      } catch (error) {
        this.db.exec('rollback');
        throw error;
      }
    };
  }

  pragma(sql, opts) {
    const row = this.db.prepare(`pragma ${sql}`).get();
    return opts && opts.simple && row ? Object.values(row)[0] : row;
  }

  close() {
    this.db.close();
    this.open = false;
  }
}

module.exports = Database;
