// Stands in for the app's lib/utils/keychain-accessibility-migration. A host without a keychain
// has nothing to migrate.
import { platform, type KeychainMigrationOutcome } from './index';

export type { KeychainMigrationOutcome } from './index';

export function runKeychainAccessibilityMigration(): Promise<KeychainMigrationOutcome> {
  return platform('keychain-accessibility-migration').runKeychainAccessibilityMigration?.() ?? Promise.resolve('not-needed');
}
