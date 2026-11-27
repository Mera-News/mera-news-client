// v59 adds article_suggestions.reading_score. The in-memory test adapter never runs
// migrations.ts, so this replays the real SQL WatermelonDB emits against node:sqlite: a v58
// article_suggestions table with a row in it, then the v59 steps.
import { DatabaseSync } from 'node:sqlite';
import { appSchema, tableSchema } from '@nozbe/watermelondb';
import type { AppSchema, SchemaMigrations } from '@nozbe/watermelondb';
// Untyped module: the SQL WatermelonDB's SQLite adapter runs for a schema and a migration.
const { encodeMigrationSteps, encodeSchema } = require('@nozbe/watermelondb/adapters/sqlite/encodeSchema') as {
  encodeSchema: (schema: AppSchema) => string;
  encodeMigrationSteps: (steps: SchemaMigrations['sortedMigrations'][number]['steps']) => string;
};
import schema from '@/lib/database/schema';
import migrations from '@/lib/database/migrations';

const migList: { toVersion: number; steps: any[] }[] = (migrations as any).sortedMigrations;
const v59 = migList.find((m) => m.toVersion === 59);

describe('v59: reading_score on article_suggestions', () => {
  it('is one additive, optional number column', () => {
    expect(schema.version).toBeGreaterThanOrEqual(59);
    expect(v59?.steps).toEqual([
      {
        type: 'add_columns',
        table: 'article_suggestions',
        columns: [{ name: 'reading_score', type: 'number', isOptional: true }],
      },
    ]);
  });

  it('upgrades an existing database, keeping its rows, with the column NULL', () => {
    const current = schema.tables.article_suggestions;
    const v58Table = tableSchema({
      name: 'article_suggestions',
      columns: current.columnArray.filter((c) => c.name !== 'reading_score'),
    });
    const db = new DatabaseSync(':memory:');
    db.exec(encodeSchema(appSchema({ version: 58, tables: [v58Table] })));
    db.prepare(
      "insert into article_suggestions (id, _status, _changed, article_id, status) values ('r1', 'created', '', 'a1', 'unscored')",
    ).run();

    db.exec(encodeMigrationSteps(v59!.steps as any));

    expect(db.prepare('select id, status, reading_score from article_suggestions').all()).toEqual([
      { id: 'r1', status: 'unscored', reading_score: null },
    ]);
  });
});
