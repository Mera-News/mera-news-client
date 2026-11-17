// Stands in for '@nozbe/watermelondb/adapters/sqlite' (default export). `new SQLiteAdapter(options)`
// returns the adapter the host builds from the same options: SQLite on a phone, anything on a server.
import type { DatabaseAdapter } from '@nozbe/watermelondb/adapters/type';
import type { SQLiteAdapterOptions } from '@nozbe/watermelondb/adapters/sqlite/type';
import { platform } from './index';

// A function called with `new` that returns an object yields that object.
const SQLiteAdapter = function SQLiteAdapter(options: SQLiteAdapterOptions) {
  return platform('sqlite-adapter').createDatabaseAdapter(options);
} as unknown as new (options: SQLiteAdapterOptions) => DatabaseAdapter;

export default SQLiteAdapter;
