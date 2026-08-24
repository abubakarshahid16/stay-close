module.exports = function (api) {
  const isTest = api.env('test');
  api.cache.using(() => (isTest ? 'test' : 'default'));

  return {
    presets: ['babel-preset-expo'],
    plugins: isTest
      ? [
          // Jest cannot evaluate a real dynamic import() without
          // --experimental-vm-modules. The web SQL driver imports sql.js
          // lazily on purpose (so a load failure is catchable rather than
          // blanking the page), and that laziness is worth keeping in the
          // bundle. Transforming it to require() for tests only lets the web
          // database actually be tested, which is how it shipped broken twice.
          'dynamic-import-node',
        ]
      : [],
  };
};
