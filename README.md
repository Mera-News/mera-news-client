# mera-news-client

All of the logic behind Mera News, without its interface. It holds the data models, services, stores, scheduler, scoring, chat and the prompt harness. A host app or a self-hosted server supplies the platform and builds the interface on top.

Mera News reads headlines and links to the publisher. It does not summarise articles. This package follows the same rule.

The Mera News phone app is one host. A self-hosted server can be another.

## Layout

Everything is under `lib/`.

- `algorithms/`: pure helpers such as scoring policy, story grouping and language ordering
- `background/`: background refresh work
- `backup/`: export and restore of local data
- `chat-session/`, `chat-tools/`: chat sessions and the tools a chat can call
- `config/`: endpoints and feature gates
- `database/`: WatermelonDB models, schema and migrations
- `diagnostics/`: system checks
- `e2ee/`: end-to-end encryption for model requests
- `explore/`, `news-search/`, `web-search/`: discovery and search
- `fact-check/`: fact checking
- `feed-grouping/`, `feed-ordering/`: how the feed is grouped and ordered
- `feedback-requests/`: feedback requests
- `generated/`: generated GraphQL types and documents
- `harnesses/`, `mera-harness/`, `news-harness/`, `news-harness-app/`: the prompt harness and its generator
- `inference/`, `llm/`: model routing, queueing and transport
- `mera-protocol/`, `mera-protocol-toolkit/`: the Mera Protocol and its toolkit
- `platform/`: the seam between this package and its host
- `scheduler/`: the task scheduler
- `services/`: data services
- `stats/`, `tracking/`: local counters the product needs to operate
- `stores/`: Zustand stores
- `subscription/`, `subscriptions/`: plan state and publisher subscriptions
- `user-context/`: the context the user chooses to share
- `utils/`: shared utilities

## Provide a platform

The package never imports a native module. The host passes the platform in once, before it imports anything else from the package. Reading a facade before that throws `PlatformNotRegisteredError`.

```ts
import { registerPlatform } from './lib/platform';

registerPlatform({
  env: process.env,
  appState,          // foreground and background events
  sentry,            // error reporting
  fetch,             // network
  asyncStorage,      // key-value storage
  secureStore,       // secrets
  getLocales,
  auth,              // session token and cookie
  apolloClient,      // GraphQL client
  createDatabaseAdapter, // database adapter for WatermelonDB
  i18n,              // i18next instance
  // optional: netInfo, onDeviceModel, showDialog, hapticLight, hydrateHostState, ...
});
```

The full shape is `PlatformHost` in `lib/platform/index.ts`. Each file in `lib/platform/` is a facade. It exports the names of one native or app module and forwards each call to the registered host.

`registerPlatform` can be called once. A second call throws.

## Scripts

Node 22.12 or later is required.

```
npm ci
npm run typecheck          # tsc --noEmit
npm run test:unit          # jest, unit project
npm run test:integration   # jest, integration project
npm run build              # compile lib/ to dist/lib
npm run check:node         # build, then load the package under plain Node
npm run harness:generate   # regenerate the prompt harness files
```

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

The names and logos are not covered by the license. See [TRADEMARK.md](TRADEMARK.md).

A company that wants to keep its changes closed can buy a commercial license. See [COMMERCIAL.md](COMMERCIAL.md).
