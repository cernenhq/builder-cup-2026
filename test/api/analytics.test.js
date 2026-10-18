// Analytics route with BigQuery off (no BQ_DATASET): the route says so and the auditor page still loads.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers');

let S;
const C = {};
test.before(async () => {
  S = await startServer({ BQ_DATASET: '' });
  for (const u of ['aud-coa', 'rev-benita', 'eng-ana', 'mayor']) C[u] = await S.login(u);
});
test.after(async () => S.close());

test('with no BQ_DATASET the analytics route returns { enabled: false }', async () => {
  for (const u of ['aud-coa', 'rev-benita']) {
    const r = await S.call('GET', '/api/audit/analytics', { cookie: C[u] });
    assert.equal(r.status, 200, u);
    assert.deepEqual(r.json, { enabled: false });
  }
});

test('analytics route is for auditor and reviewer only', async () => {
  assert.equal((await S.call('GET', '/api/audit/analytics')).status, 401);
  assert.equal((await S.call('GET', '/api/audit/analytics', { cookie: C['eng-ana'] })).status, 403);
  assert.equal((await S.call('GET', '/api/audit/analytics', { cookie: C.mayor })).status, 403);
});

test('auditor page and its script still load with analytics off', async () => {
  const page = await S.call('GET', '/auditor', { cookie: C['aud-coa'] });
  assert.equal(page.status, 200);
  const js = await S.call('GET', '/static/auditor.js');
  assert.equal(js.status, 200);
  assert.match(js.text, /analytics-card/);
});
