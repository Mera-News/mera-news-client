// Setup for the services, scheduler and chat tests.
//
// A mute holds its purge on a 60 s timer, and a jest worker outlives the file that started it: the
// timer would fire in a later file, against a torn-down module registry. Required inside the hook,
// for the reason test/setup/llm.ts gives.
// A staged topic delete holds a timer the same way.
afterEach(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  for (const cancel of [
    () => require('@/lib/database/services/publication-pref-ui-actions').cancelPendingPurges(),
    () => require('@/lib/database/services/topic-decline-service').cancelPendingDeletes(),
  ]) {
    try {
      cancel();
    } catch {
      // A test that makes a store unloadable cannot have muted a publication or staged a delete.
    }
  }
  /* eslint-enable @typescript-eslint/no-require-imports */
});

export {};
