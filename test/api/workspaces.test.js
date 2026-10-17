// Per-visitor workspaces and the judge access code (the public demo's settings: WORKSPACES=1).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers');

let S;
test.before(async () => {
  S = await startServer({ WORKSPACES: '1', JUDGE_CODE: 'judge-test-code' });
});
test.after(async () => S.close());

// A tiny cookie jar per visitor.
function visitor() {
  const jar = new Map();
  return {
    jar,
    get cookie() {
      return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    async call(method, p, body) {
      const r = await S.call(method, p, { cookie: this.cookie, body });
      for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
        const [kv] = c.split(';');
        const i = kv.indexOf('=');
        const k = kv.slice(0, i);
        const v = kv.slice(i + 1);
        if (/Max-Age=0/.test(c)) jar.delete(k);
        else jar.set(k, v);
      }
      return r;
    }
  };
}

test('anyone can read the seeded demo without creating a workspace', async () => {
  const v = visitor();
  const r = await v.call('GET', '/api/public/projects');
  assert.equal(r.status, 200);
  assert.ok(r.json.length >= 3);
  assert.ok(!v.jar.has('pop_ws'));
  const m = await v.call('GET', '/api/meta');
  assert.equal(m.json.workspace.own, false);
  assert.equal(m.json.access.judge, false);
});

test('each visitor works on a private copy; switching roles keeps the same copy', async () => {
  const a = visitor();
  const b = visitor();
  assert.equal((await a.call('POST', '/api/auth/login', { userId: 'eng-ana' })).status, 200);
  assert.equal((await b.call('POST', '/api/auth/login', { userId: 'eng-ana' })).status, 200);
  assert.ok(a.jar.get('pop_ws') && b.jar.get('pop_ws') && a.jar.get('pop_ws') !== b.jar.get('pop_ws'));
  const d = await a.call('POST', '/api/projects/P-003/periods/2026-05/decisions', { lineKey: 'cb', decision: 'contradicted', reason: 'Visitor A override' });
  assert.equal(d.status, 200);
  const seenByB = await b.call('GET', '/api/projects/P-003/periods/2026-05');
  const lineB = seenByB.json.check.lines.find((l) => l.lineKey === 'cb');
  assert.ok(!lineB.decision || lineB.decision.reason !== 'Visitor A override');
  // Visitor A switches to the office head and still sees their own decision.
  await a.call('POST', '/api/auth/logout');
  assert.equal((await a.call('POST', '/api/auth/login', { userId: 'rev-benita' })).status, 200);
  const seenByA = await a.call('GET', '/api/projects/P-003/periods/2026-05');
  assert.equal(seenByA.json.check.lines.find((l) => l.lineKey === 'cb').decision.reason, 'Visitor A override');
  // A fresh visitor still sees the untouched seeded demo.
  const c = visitor();
  const pub = await c.call('GET', '/api/public/projects/P-003');
  assert.equal(pub.status, 200);
});

test('the judge access code: wrong code refused, right code sets access', async () => {
  const v = visitor();
  assert.equal((await v.call('POST', '/api/access', { code: 'nope' })).status, 403);
  assert.equal((await v.call('POST', '/api/access', { code: 'judge-test-code' })).status, 200);
  assert.ok(v.jar.has('pop_judge'));
  const m = await v.call('GET', '/api/meta');
  assert.equal(m.json.access.judge, true);
  assert.ok(!v.jar.has('pop_ws'), 'entering the code alone does not create a workspace');
});

test('requests that fail validation create no copy and use none of the daily limit', async () => {
  const day = () => S.built.rootStore.find('limits', {});
  const before = (await day()).reduce((n, d) => n + d.workspaces, 0);
  const v = visitor();
  // No app header, unknown user, unknown contractor link, signed-out write.
  await S.call('POST', '/api/auth/login', { body: { userId: 'eng-ana' }, headers: { 'x-pop-request': '0' } });
  assert.equal((await v.call('POST', '/api/auth/login', { userId: 'nobody' })).status, 400);
  assert.equal((await v.call('POST', '/api/contractor/not-a-real-link-123/submissions', {})).status, 404);
  assert.equal((await v.call('POST', '/api/projects/P-001/periods/2026-04/decisions', { lineKey: 're', decision: 'supported', reason: 'x y z' })).status, 401);
  assert.equal((await v.call('POST', '/api/auth/logout')).status, 200);
  assert.ok(!v.jar.has('pop_ws'));
  const after = (await day()).reduce((n, d) => n + d.workspaces, 0);
  assert.equal(after, before);
});

test('a signed-in visitor without a copy cannot change the shared demo', async () => {
  const v = visitor();
  await v.call('POST', '/api/auth/login', { userId: 'eng-ana' });
  v.jar.delete('pop_ws'); // keep the sign-in, lose the copy
  const r = await v.call('POST', '/api/projects/P-001/periods/2026-04/decisions', { lineKey: 're', decision: 'supported', reason: 'Visible in the photo' });
  assert.equal(r.status, 403);
  assert.match(r.json.error, /own copy/);
});

test('simultaneous sign-ins cannot pass the daily limit of new copies', async () => {
  const S2 = await startServer({ WORKSPACES: '1', WORKSPACES_PER_DAY: '1' });
  try {
    const res = await Promise.all([1, 2, 3, 4, 5].map(() => S2.call('POST', '/api/auth/login', { body: { userId: 'eng-ana' } })));
    assert.equal(res.filter((r) => r.status === 200).length, 1);
    assert.equal(res.filter((r) => r.status === 429).length, 4);
    const lim = await S2.built.rootStore.find('limits', {});
    assert.equal(lim.reduce((n, d) => n + d.workspaces, 0), 1);
  } finally {
    await S2.close();
  }
});

test('after a new check run, old decisions no longer count downstream until a person decides again', async () => {
  const v = visitor();
  await v.call('POST', '/api/auth/login', { userId: 'eng-ana' });
  const before = await v.call('GET', '/api/projects/P-001/periods/2026-04');
  assert.ok(before.json.check.lines.some((l) => l.decision));
  assert.equal((await v.call('POST', '/api/projects/P-001/periods/2026-04/check', {})).status, 200);
  const after = await v.call('GET', '/api/projects/P-001/periods/2026-04');
  assert.ok(after.json.check.lines.every((l) => !l.decision));
  assert.ok(after.json.check.lines.some((l) => l.earlierDecision));
});

test('changing the claims after a check marks it stale: decisions stop counting and deciding is refused', async () => {
  const v = visitor();
  await v.call('POST', '/api/auth/login', { userId: 'eng-ana' });
  const per = await v.call('GET', '/api/projects/P-001/periods/2026-04');
  const claims = per.json.claims.map((c) => ({ lineKey: c.lineKey, claimedPct: c.claimedPct === 100 ? 90 : 100 }));
  assert.equal((await v.call('PUT', '/api/projects/P-001/periods/2026-04/claims', { claims })).status, 200);
  const after = await v.call('GET', '/api/projects/P-001/periods/2026-04');
  assert.equal(after.json.checkStale, true);
  assert.ok(after.json.check.lines.every((l) => !l.decision));
  const d = await v.call('POST', '/api/projects/P-001/periods/2026-04/decisions', { lineKey: 're', decision: 'supported', reason: 'Visible in the photo' });
  assert.equal(d.status, 400);
  assert.match(d.json.error, /Run the check again/);
  assert.equal((await v.call('POST', '/api/projects/P-001/periods/2026-04/check', {})).status, 200);
  assert.equal((await v.call('GET', '/api/projects/P-001/periods/2026-04')).json.checkStale, false);
});

test('an invalid submission on a valid contractor link creates no copy', async () => {
  const before = (await S.built.rootStore.find('limits', {})).reduce((n, d) => n + d.workspaces, 0);
  const v = visitor();
  for (const form of [{ claims: '{not json', period: '2026-05' }, { claims: '[]', period: '2026-05' }, { claims: '[{"lineKey":"zz","claimedPct":50}]', period: '2026-05' }, { claims: '[]', period: 'May' }]) {
    const fd = new FormData();
    for (const [k, val] of Object.entries(form)) fd.append(k, val);
    const r = await S.call('POST', '/api/contractor/demo-P-002-uno-link/submissions', { form: fd });
    assert.equal(r.status, 400, JSON.stringify(form));
  }
  assert.ok(!v.jar.has('pop_ws'));
  const after = (await S.built.rootStore.find('limits', {})).reduce((n, d) => n + d.workspaces, 0);
  assert.equal(after, before);
});
