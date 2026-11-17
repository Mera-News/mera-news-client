// The in-memory DB reset. The database loads lazily, on the first reset, so a test's own
// jest.mock of a database module still applies.
export async function resetDatabase(): Promise<void> {
  const database = require('@/lib/database').default;
  await database.write(() => database.unsafeResetDatabase());
}
