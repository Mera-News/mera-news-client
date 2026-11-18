// Setup for the services, scheduler and chat tests.
//
// A mute holds its purge on a 60 s timer, and a jest worker outlives the file that started it: the
// timer would fire in a later file, against a torn-down module registry. Required inside the hook,
// for the reason test/setup/llm.ts gives.
afterEach(() => {
  let actions: typeof import('@/lib/database/services/publication-pref-ui-actions');
  try {
    /* eslint-disable-next-line @typescript-eslint/no-require-imports */
    actions = require('@/lib/database/services/publication-pref-ui-actions');
  } catch {
    // A test that makes a store unloadable cannot have muted a publication either.
    return;
  }
  actions.cancelPendingPurges();
});

export {};
