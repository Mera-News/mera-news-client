// Build-time configuration by name, from the host (`env.EXPO_PUBLIC_INFERENCE_ENDPOINT`). Stands in
// for `process.env`, which a bundler may not inline inside a dependency. Read at the time of access.
import { forward } from './index';

export const env: Readonly<Record<string, string | undefined>> = forward('env', (host) => host.env);
