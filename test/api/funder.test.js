// The owner and lender view (funder): one read-only overview, the plan view, photos; every write refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers');

let S;
let C;
test.before(async () => {
  S = await startServer();
  C = await S.login('fund-grace');
});
test.after(async () => S.close());

test('the funder sees a read-only overview built from what a person decided', async () => {
  const r = await S.call('GET', '/api/funder/overview', { cookie: C });
  assert.equal(r.status, 200);
  const p1 = r.json.projects.find((p) => p.id === 'P-001');
  assert.ok(p1.percent && typeof p1.percent.value === 'number');
  assert.equal(p1.latestChecked.period, '2026-04');
  const c = p1.latestChecked.counts;
  assert.equal(c.supported + c.contradicted + c.not_assessable + c.waiting, 4);
  assert.equal(p1.hasOverlay, true);
  assert.match(r.json.note, /Read only/);
  const page = await S.call('GET', '/funder', { cookie: C });
  assert.equal(page.status, 200);
  assert.match(page.text, /owner\/overlay\.js/);
});

test('the funder can open the plan view and site photos, and nothing else', async () => {
  assert.equal((await S.call('GET', '/api/owner/projects/P-001/trajectory', { cookie: C })).status, 200);
  for (const p of ['/api/projects', '/api/review/monday', '/api/mayor/escalations', '/api/audit/projects/P-001/log']) assert.equal((await S.call('GET', p, { cookie: C })).status, 403, p);
  const writes = [
    ['POST', '/api/projects/P-001/periods/2026-04/decisions', { lineKey: 're', decision: 'supported', reason: 'x y z' }],
    ['PUT', '/api/projects/P-001/periods/2026-04/claims', { claims: [] }],
    ['POST', '/api/projects/P-001/periods/2026-04/check', {}],
    ['PUT', '/api/projects/P-001/periods/2026-04/percent', { value: 70 }],
    ['POST', '/api/projects/P-001/monitoring', { date: '2026-05-01', kind: 'Site visit' }]
  ];
  for (const [m, p, body] of writes) assert.equal((await S.call(m, p, { cookie: C, body })).status, 403, `${m} ${p}`);
  const eng = await S.login('eng-ana');
  assert.equal((await S.call('GET', '/api/funder/overview', { cookie: eng })).status, 403);
});
