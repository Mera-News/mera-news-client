// One compiler for every target: jest, the dist build for Node, and (through the host's own
// bundler) the app. The package itself is plain TypeScript with CommonJS output.
module.exports = {
  presets: [['@babel/preset-typescript', { onlyRemoveTypeImports: false }]],
  plugins: [
    // WatermelonDB models use legacy field decorators (`@field('x') x!: string`). The decorator
    // must run before class properties, and class properties must be loose, or the field
    // shadows the getter the decorator installs.
    ['@babel/plugin-proposal-decorators', { legacy: true }],
    ['@babel/plugin-transform-class-properties', { loose: true }],
    // Loose class properties need the private members loose too (msw's classes use them).
    ['@babel/plugin-transform-private-methods', { loose: true }],
    ['@babel/plugin-transform-private-property-in-object', { loose: true }],
    // Babel 7 leaves import() native, and Node's import() resolves no extensions, so the built
    // package's lazy imports only ran under a loader such as tsx. This turns them into require.
    '@babel/plugin-transform-dynamic-import',
    '@babel/plugin-transform-modules-commonjs',
    ['module-resolver', { root: ['./'], alias: { '@': './' } }],
  ],
};
