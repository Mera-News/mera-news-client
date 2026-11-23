# mera-news-client

All of the logic behind Mera News, without its interface. It holds the data models, services, stores, scheduler, scoring, chat and the prompt harness. A host app or a self-hosted server supplies the platform and builds the interface on top.

Mera News reads headlines and links to the publisher. It does not summarise articles. This package follows the same rule.

The Mera News phone app is one host. A self-hosted server can be another.

## Layout

Everything is under `lib/`.

- `algorithms/`: pure helpers, for example model attestation checks, story grouping, language and country names, version compare
- `background/`: the logic behind background scoring runs (the OS task itself belongs to the host)
- `backup/`: export and import of the local database
- `chat-session/`: the chat turn engines and session, kept outside any screen
- `chat-tools/`: what the chat's tool calls do on the device (facts, proposals, news and web search)
- `config/`: endpoints and feature gates
- `database/`: WatermelonDB schema, migrations, models and the services that read and write them
- `diagnostics/`: a development timeline of the cold start
- `e2ee/`: end-to-end encryption between the device and the confidential models
- `explore/`: the scopes and country lists the World pages are built from
- `fact-check/`: fact checks, the quick check in chat and the server check per article
- `feed-grouping/`: scoring gates and score sharing between articles of one story
- `feed-ordering/`: the order and filters of the feed
- `feedback-requests/`: questions the Mera team asks in the app, and their answers
- `generated/`: GraphQL types generated from the server schema
- `harnesses/`: the prompt text and parameters per model, in base folders that model folders extend
- `inference/`: the queue of on-device model jobs
- `llm/`: model routing, profiles and the transport to the confidential gateway
- `mera-harness/`: the persona chat agent, its loop and its skills
- `mera-protocol/`: on-device scoring and topic generation
- `mera-protocol-toolkit/`: types and helpers shared with the on-device models
- `news-harness/`: prompt builders, the scoring engine, the article pipeline and the on-device chat flows
- `news-harness-app/`: connects the news harness to the logger
- `news-search/`: the headline search
- `platform/`: the seam between this package and its host
- `scheduler/`: the task scheduler, feed sync and the client start sequence
- `services/`: scoring runs, suggestion sync and feedback handling
- `stats/`: reading activity and stats computed on the device
- `stores/`: Zustand stores
- `subscription/`: the daily reading limit and the reading plans
- `subscriptions/`: the sources of a publisher
- `tracking/`: following a story and its timeline
- `user-context/`: the reader's places and languages, for ordering
- `utils/`: retry and sleep
- `web-search/`: web search through the gateway

Files at the top of `lib/` hold the logger, the restart rules, the GraphQL services (account, articles, places, publication display) and a few small shared modules.

## Install

The package is not on npm. The `dist` branch holds the built package, one commit per build of `main`. Pin a `dist` commit by its full hash:

```
npm install "git+https://github.com/Mera-News/mera-news-client.git#<dist commit>"
```

A host that compiles TypeScript itself can pin a `main` commit instead and build `lib/` with its own toolchain.

## Not supported yet

- No stable API. Any commit may change what the package exports; pin a commit and read the history before you move.
- No npm releases or version tags.
- The Mera News phone app is not in this repository, and the account, subscription and notification services stay with Mera.
- Requests to Mera's servers carry the account's session, so the server sees the account with each request while it answers. No stored record links an account to a topic. The [Mera News app README](https://github.com/Mera-News/mera-app#what-is-public-and-what-is-private) lists what is public and what is private.
- News comes from a news server's GraphQL API, such as `mera-news-data-server`. `news-schema.gql` is the public news schema the package's news requests are checked against.

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

Node 22.13 or later is required.

```
npm ci
npm run typecheck          # tsc --noEmit
npm run test:unit          # jest, unit project
npm run test:integration   # jest, integration project
npm run build              # compile lib/ to dist/lib
npm run check:node         # build, then load the package under plain Node
npm run harness:generate   # regenerate the prompt harness files
npm run codegen            # regenerate lib/generated/graphql-types.ts from schema.gql
```

`schema.gql` is a copy of the server's GraphQL schema. To target your own server, replace it with
your server's schema and run `npm run codegen`.

## Contributions

Pull requests are welcome. See `CONTRIBUTING.md`. To report a security problem, write to contact@mera.news.

## Licence

Copyright Mera Labs B.V.

Required Notice: Copyright Mera Labs B.V. (https://mera.news)

This code is source-available under the PolyForm Shield License 1.0.0. See `LICENSE`.

In short: you may run it, change it and build on it for any purpose, except to provide a product
that competes with this software or with a product Mera Labs provides using it, such as Mera News.
This summary is not the licence. The `LICENSE` file is.

Mera News and Mera Protocol are trademarks. See `TRADEMARK.md`.
For a use the licence does not allow, see `COMMERCIAL.md`.
To contribute, see `CONTRIBUTING.md`.
