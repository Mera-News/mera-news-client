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
    '@babel/plugin-transform-modules-commonjs',
    ['module-resolver', { root: ['./'], alias: { '@': './' } }],
  ],
};
