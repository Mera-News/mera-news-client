// lib/database builds its adapter through the platform host, with the schema, the migrations and
// the open options the package owns.
import migrations from '@/lib/database/migrations';
import { testHost } from '@/test/helpers';

type AdapterOptions = Parameters<typeof testHost.createDatabaseAdapter>[0];

/** The highest `toVersion` in the migrations: the schema must sit at the same version. */
const maxMigrationVersion = (): number =>
  Math.max(...(migrations as unknown as { sortedMigrations: { toVersion: number }[] }).sortedMigrations.map((m) => m.toVersion));

it('asks the host for its adapter once, with the schema, the migrations, jsi and an error hook', () => {
  const create = jest.spyOn(testHost, 'createDatabaseAdapter');

  jest.isolateModules(() => {
    // A fresh module registry has no host yet: register the one under test.
    const { registerPlatform } = require('@/lib/platform') as typeof import('@/lib/platform');
    registerPlatform(testHost);
    require('@/lib/database');
  });

  expect(create).toHaveBeenCalledTimes(1);
  const options = create.mock.calls[0][0] as AdapterOptions;
  expect(options).toEqual({
    schema: expect.anything(),
    migrations: expect.anything(),
    jsi: true,
    onSetUpError: expect.any(Function),
  });
  expect(options.schema.version).toBe(maxMigrationVersion());
});
