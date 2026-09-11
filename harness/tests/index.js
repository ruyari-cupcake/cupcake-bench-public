// Node treats an explicit test-directory argument as a module entrypoint.
// Discover test files here so `node --test harness/tests/` runs the whole suite.
const { readdirSync } = require('node:fs');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

(async () => {
  for (const file of readdirSync(__dirname).filter((name) => name.endsWith('.test.mjs')).sort()) {
    await import(pathToFileURL(path.join(__dirname, file)).href);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
