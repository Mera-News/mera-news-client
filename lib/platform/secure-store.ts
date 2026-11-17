// Stands in for the app's lib/utils/secure-store-adapter: the keychain, with the host's own
// accessibility settings. A missing item resolves null; a transient failure rejects.
import { forward } from './index';

export const secureStore = forward('secure-store', (host) => host.secureStore);
