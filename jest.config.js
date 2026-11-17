// Two projects:
// - unit: pure algorithms, no setup, no platform.
// - integration: tests at a service seam, run against the test platform host, MSW and the
//   in-memory database. test/setup/index.ts registers the host and loads each area's setup.
//
// These packages ship untranspiled ESM and must go through Babel.
const ESM_PACKAGES = [
  '@noble',
  '@apollo',
  'graphql',
  'msw',
  '@mswjs',
  '@bundled-es-modules',
  '@open-draft',
  'until-async',
  'rettime',
  'outvariant',
  'strict-event-emitter',
  'headers-polyfill',
].join('|');

const base = {
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'mjs', 'cjs', 'json'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  // import() becomes a require inside a promise: Jest runs CommonJS without VM modules.
  transform: {
    '\\.[cm]?[jt]s$': ['babel-jest', { plugins: [require.resolve('./test/helpers/babel-dynamic-import.js')] }],
  },
  transformIgnorePatterns: [`node_modules/(?!(${ESM_PACKAGES})/)`],
  modulePathIgnorePatterns: ['<rootDir>/dist'],
  globals: { __DEV__: true },
};

module.exports = {
  projects: [
    {
      ...base,
      displayName: 'unit',
      testMatch: ['<rootDir>/lib/algorithms/__tests__/**/*.test.ts', '<rootDir>/test/unit/**/*.test.ts'],
    },
    {
      ...base,
      displayName: 'integration',
      // Call history resets before every test; implementations stay (resetMocks would wipe them).
      clearMocks: true,
      setupFilesAfterEnv: ['<rootDir>/test/setup/index.ts'],
      testMatch: ['<rootDir>/test/integration/**/*.test.ts'],
    },
  ],
};
