// Registers the test platform host before any package module loads, and resets it before each test.
// Endpoints point at the in-process mock backend; config/endpoints reads them while it loads.
process.env.EXPO_PUBLIC_GRAPHQL_SERVER_ENDPOINT = 'http://127.0.0.1:8790';
process.env.EXPO_PUBLIC_AUTH_ENDPOINT = 'http://127.0.0.1:8790';
process.env.EXPO_PUBLIC_INFERENCE_ENDPOINT = 'http://127.0.0.1:8790';

import { installTestPlatform, resetTestPlatform } from '../helpers/platform-host';

installTestPlatform();

beforeEach(() => {
  resetTestPlatform();
});
