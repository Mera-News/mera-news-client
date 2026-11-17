// Stands in for 'expo/fetch': a fetch whose response body can be streamed.
import { platform } from './index';

export const fetch: typeof globalThis.fetch = (input, init) => platform('fetch').fetch(input, init);
