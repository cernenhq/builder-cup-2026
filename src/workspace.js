// Per-visitor demo workspaces. Each visitor who changes anything gets a private copy of the seeded
// demo ("template"), so judges arriving on different days never see each other's decisions.
// The current workspace travels with the request through AsyncLocalStorage; the store and the photo
// keys read it. With WORKSPACES off (local runs, tests) everything uses one workspace, "main".
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();
const TEMPLATE = 'template';
const MAIN = 'main';

function currentWs() {
  const s = als.getStore();
  return (s && s.ws) || null;
}

// Run fn with a fixed workspace (seeding, scripts).
function runInWs(ws, fn) {
  return als.run({ ws }, fn);
}

// Photo storage prefix: uploads inside a visitor workspace live under ws/<id>/ so a bucket lifecycle
// rule can delete them; seeded photos live under seed/.
function photoKeyPrefix() {
  const ws = currentWs();
  if (!ws || ws === MAIN) return '';
  if (ws === TEMPLATE) return 'seed/';
  return `ws/${ws}/`;
}

module.exports = { als, currentWs, runInWs, photoKeyPrefix, TEMPLATE, MAIN };
