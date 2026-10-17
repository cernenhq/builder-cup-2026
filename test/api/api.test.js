// API tests: role guards are enforced on the server, and the core jobs work end to end.
// Runs on the in-memory store, and on the Firestore emulator with STORE=firestore.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, SEED_PHOTOS } = require('../helpers');
const { findBanned } = require('../../src/domain/wording');
const { USERS } = require('../../src/seed/demo-data');

let S;
const C = {};
test.before(async () => {
  S = await startServer();
  for (const u of ['eng-ana', 'eng-carlo', 'rev-benita', 'mayor', 'aud-coa']) C[u] = await S.login(u);
});
test.after(async () => S.close());

const VERDICT_WORDS = /supported|contradicted|not_assessable|can't tell|aiDefault|readers|verdict|disagree/i;

test('signed-out requests get 401; pages redirect to sign-in', async () => {
  assert.equal((await S.call('GET', '/api/projects')).status, 401);
  assert.equal((await S.call('GET', '/api/mayor/escalations')).status, 401);
  const page = await S.call('GET', '/reviewer');
  assert.equal(page.status, 302);
});

test('state-changing requests without the app header are refused', async () => {
  const r = await S.call('POST', '/api/projects/P-001/monitoring', { cookie: C['eng-ana'], body: { date: '2026-05-30', kind: 'Site visit' }, headers: { 'x-pop-request': '0' } });
  assert.equal(r.status, 403);
});

test('mayor sees escalations and nothing else', async () => {
  const e = await S.call('GET', '/api/mayor/escalations', { cookie: C.mayor });
  assert.equal(e.status, 200);
  assert.ok(e.json.items.length >= 1);
  for (const p of ['/api/projects', '/api/projects/P-001', '/api/review/monday', '/api/audit/projects/P-001/log', '/api/review/overrides']) {
    assert.equal((await S.call('GET', p, { cookie: C.mayor })).status, 403, p);
  }
  assert.equal((await S.call('POST', '/api/projects/P-001/periods/2026-05/decisions', { cookie: C.mayor, body: { lineKey: 'ho', decision: 'supported', reason: 'x' } })).status, 403);
});

test('engineer decides lines only on their own projects, cannot see the mayor screen or change other projects', async () => {
  const ana = C['eng-ana'];
  assert.equal((await S.call('GET', '/api/mayor/escalations', { cookie: ana })).status, 403);
  // P-003 is Ana's: she has the last word on its lines, and the log keeps the AI default with her call.
  const own = await S.call('POST', '/api/projects/P-003/periods/2026-05/decisions', { cookie: ana, body: { lineKey: 'cb', decision: 'supported', reason: 'Visible in the photo' } });
  assert.equal(own.status, 200);
  assert.equal(own.json.decision.by.role, 'engineer');
  assert.ok('aiDefault' in own.json.decision);
  // P-002 is Carlo's: Ana cannot decide its lines.
  assert.equal((await S.call('POST', '/api/projects/P-002/periods/2026-05/decisions', { cookie: ana, body: { lineKey: 'x', decision: 'supported', reason: 'looks fine' } })).status, 403);
  // P-002 is Carlo's project.
  assert.equal((await S.call('PUT', '/api/projects/P-002/periods/2026-05/percent', { cookie: ana, body: { value: 50 } })).status, 403);
  assert.equal((await S.call('PUT', '/api/projects/P-002/periods/2026-05/percent', { cookie: C['eng-carlo'], body: { value: 38 } })).status, 200);
});

test('auditor can read logs but every write is refused', async () => {
  const a = C['aud-coa'];
  const log = await S.call('GET', '/api/audit/projects/P-001/log', { cookie: a });
  assert.equal(log.status, 200);
  assert.ok(log.json.decisions.length > 20);
  assert.ok(log.json.decisions.every((d) => d.by && d.by.name && d.at));
  const writes = [
    ['PUT', '/api/projects/P-001/periods/2026-05/percent', { value: 70 }],
    ['PUT', '/api/projects/P-001/periods/2026-05/claims', { claims: [] }],
    ['POST', '/api/projects/P-001/periods/2026-05/check', {}],
    ['POST', '/api/projects/P-003/periods/2026-05/decisions', { lineKey: 'cb', decision: 'supported', reason: 'x' }],
    ['POST', '/api/projects/P-001/transmittals', { reportKind: 'COA', periodKey: '2026-05', submittedOn: '2026-06-01', to: 'COA' }],
    ['POST', '/api/projects/P-001/monitoring', { date: '2026-05-30', kind: 'Site visit' }],
    ['POST', '/api/projects/P-001/contractor-link', {}],
    ['POST', '/api/projects/P-001/periods/2026-05/flag-notes', { photoId: 'x', checkKey: 'reuse', explanation: 'x' }]
  ];
  for (const [m, p, body] of writes) assert.equal((await S.call(m, p, { cookie: a, body })).status, 403, `${m} ${p}`);
  assert.equal((await S.call('GET', '/api/mayor/escalations', { cookie: a })).status, 403);
});

test('contractor link: own project only, no verdicts, bad links refused', async () => {
  const bad = await S.call('GET', '/api/contractor/not-a-real-link-123');
  assert.equal(bad.status, 404);
  const r = await S.call('GET', '/api/contractor/demo-P-003-dos-link');
  assert.equal(r.status, 200);
  assert.equal(r.json.project.name, 'Barangay hall annex, two storeys (demo)');
  assert.ok(!VERDICT_WORDS.test(r.text), 'contractor response carries no verdicts');
  // A contractor cookie does not exist; staff APIs stay closed to them.
  assert.equal((await S.call('GET', '/api/projects/P-003/periods/2026-05')).status, 401);
  // Submitting works and returns only a receipt.
  const fd = new FormData();
  fd.append('period', '2026-05');
  fd.append('claims', JSON.stringify([{ lineKey: 'sb', claimedPct: 100 }, { lineKey: 'pccp', claimedPct: 45 }]));
  fd.append('photos', new Blob([fs.readFileSync(path.join(SEED_PHOTOS, 'p05.jpg'))], { type: 'image/jpeg' }), 'road.jpg');
  const s = await S.call('POST', '/api/contractor/demo-P-002-uno-link/submissions', { form: fd });
  assert.equal(s.status, 200);
  assert.equal(s.json.lines, 2);
  assert.ok(!VERDICT_WORDS.test(s.text));
  // The office sees it arrive.
  const per = await S.call('GET', '/api/projects/P-002/periods/2026-05', { cookie: C['eng-carlo'] });
  assert.equal(per.json.claimsSource, 'contractor');
  assert.equal(per.json.photos.length, 1);
});

test('public note has no verdict labels and no staff names', async () => {
  const list = await S.call('GET', '/api/public/projects');
  assert.equal(list.status, 200);
  for (const id of ['P-001', 'P-002', 'P-003']) {
    const r = await S.call('GET', `/api/public/projects/${id}`);
    assert.equal(r.status, 200);
    assert.ok(!/supported|contradicted|not_assessable|can't tell|disagree|verdict/i.test(r.text), id);
    for (const u of USERS) assert.ok(!r.text.includes(u.name.replace(' (demo)', '')), `${id} names ${u.name}`);
    assert.deepEqual(findBanned(r.text), []);
  }
  const p1 = (await S.call('GET', '/api/public/projects/P-001')).json;
  assert.ok(p1.photosShow.length > 0);
  assert.ok(p1.notVisible.includes('Roof waterproofing'));
});

test('engineer: upload, type the claim, run the check; hidden work comes back as can\'t tell', async () => {
  const ana = C['eng-ana'];
  const fd = new FormData();
  fd.append('photos', new Blob([fs.readFileSync(path.join(SEED_PHOTOS, 'p11.jpg'))], { type: 'image/jpeg' }), 'p11.jpg');
  fd.append('stampText', '05-21-2026 Thu 11:12:21');
  assert.equal((await S.call('POST', '/api/projects/P-001/periods/2026-05/photos', { cookie: ana, form: fd })).status, 200);
  const chk = await S.call('POST', '/api/projects/P-001/periods/2026-05/check', { cookie: ana });
  assert.equal(chk.status, 200);
  const lines = chk.json.check.lines;
  assert.equal(lines.length, 3);
  assert.equal(lines.find((l) => l.lineKey === 'fo').aiDefault, 'not_assessable');
  assert.equal(chk.json.check.aiMode, 'mock');
  const pc = chk.json.check.photoChecks[0].findings;
  assert.equal(pc.find((f) => f.key === 'reuse').level, 'ok');
  assert.ok(pc.find((f) => f.key === 'comparable'));
});

test('reviewer: a reason is required; an override is logged with reason, name and time', async () => {
  const b = C['rev-benita'];
  const noReason = await S.call('POST', '/api/projects/P-003/periods/2026-05/decisions', { cookie: b, body: { lineKey: 'cb', decision: 'supported', reason: '' } });
  assert.equal(noReason.status, 400);
  const per = (await S.call('GET', '/api/projects/P-003/periods/2026-05', { cookie: b })).json;
  const cb = per.check.lines.find((l) => l.lineKey === 'cb');
  const other = cb.aiDefault === 'contradicted' ? 'supported' : 'contradicted';
  const d = await S.call('POST', '/api/projects/P-003/periods/2026-05/decisions', { cookie: b, body: { lineKey: 'cb', decision: other, reason: 'Columns visible on the 15 April site visit.' } });
  assert.equal(d.status, 200);
  assert.equal(d.json.decision.overrode, true);
  const log = (await S.call('GET', '/api/audit/projects/P-003/log', { cookie: C['aud-coa'] })).json;
  const entry = log.decisions.find((x) => x.lineKey === 'cb');
  assert.equal(entry.reason, 'Columns visible on the 15 April site visit.');
  assert.equal(entry.by.name, 'Benita Cruz (demo)');
  assert.ok(entry.at);
  const ov = (await S.call('GET', '/api/review/overrides', { cookie: b })).json;
  assert.ok(ov.some((x) => x.projectId === 'P-003' && x.lineKey === 'cb'));
});

test('unreviewed AI output never escalates to the mayor', async () => {
  const items = (await S.call('GET', '/api/mayor/escalations', { cookie: C.mayor })).json.items;
  assert.ok(!items.some((i) => i.projectName.startsWith('Barangay hall annex') && i.kind === 'claims_photos_disagree'));
});

test('percent complete entered once flows to all four drafts in every format', async () => {
  const ana = C['eng-ana'];
  assert.equal((await S.call('PUT', '/api/projects/P-001/periods/2026-05/percent', { cookie: ana, body: { value: 'abc' } })).status, 400);
  assert.equal((await S.call('PUT', '/api/projects/P-001/periods/2026-05/percent', { cookie: ana, body: { value: 70 } })).status, 200);
  const r = await S.call('GET', '/api/projects/P-001/periods/2026-05/reports', { cookie: ana });
  assert.deepEqual(r.json.drafts.map((d) => [d.kind, d.percent]), [['COA', 70], ['SUBAYBAYAN', 70], ['IAS', 70], ['MPDO', 70]]);
  for (const k of ['COA', 'SUBAYBAYAN', 'IAS', 'MPDO'])
    for (const ext of ['txt', 'csv', 'html']) {
      const f = await S.call('GET', `/api/projects/P-001/periods/2026-05/reports/${k}.${ext}`, { cookie: ana });
      assert.equal(f.status, 200);
      assert.match(f.text, /70%/);
      assert.match(f.text, /DRAFT/);
    }
  // The mayor's 70% milestone item for P-001 clears once 70% is entered.
  const items = (await S.call('GET', '/api/mayor/escalations', { cookie: C.mayor })).json.items;
  assert.ok(!items.some((i) => i.kind === 'milestone_overdue' && i.projectName.startsWith('Multi-purpose')));
});

test('submission log: on time vs late (flagged, not counted); future dates refused', async () => {
  const ana = C['eng-ana'];
  const ok = await S.call('POST', '/api/projects/P-001/transmittals', { cookie: ana, body: { reportKind: 'COA', periodKey: '2026-05', submittedOn: '2026-06-01', to: 'COA resident auditor' } });
  assert.equal(ok.json.transmittal.late, false);
  assert.equal(ok.json.transmittal.due, '2026-06-05');
  const late = await S.call('POST', '/api/projects/P-002/transmittals', { cookie: C['eng-carlo'], body: { reportKind: 'SUBAYBAYAN', periodKey: '2026-05', submittedOn: '2026-05-30', to: 'DILG municipal field office' } });
  assert.equal(late.json.transmittal.late, true);
  assert.equal(late.json.transmittal.countsAsOnTime, false);
  const fut = await S.call('POST', '/api/projects/P-001/transmittals', { cookie: ana, body: { reportKind: 'COA', periodKey: '2026-06', submittedOn: '2026-07-01', to: 'COA' } });
  assert.equal(fut.status, 400);
  // The overdue DILG item for P-002 leaves the mayor's screen; the late submission stays as an office flag.
  const items = (await S.call('GET', '/api/mayor/escalations', { cookie: C.mayor })).json.items;
  assert.ok(!items.some((i) => i.kind === 'report_overdue' && i.projectName.startsWith('Farm-to-market')));
  const monday = (await S.call('GET', '/api/review/monday', { cookie: C['rev-benita'] })).json;
  assert.ok(monday.office.some((i) => i.kind === 'report_late' && i.projectId === 'P-002' && i.level === 1));
});

test('monitoring credit and the auto-credit when the office types the claim', async () => {
  const carlo = C['eng-carlo'];
  const m = await S.call('POST', '/api/projects/P-002/monitoring', { cookie: carlo, body: { date: '2026-05-29', kind: 'Site visit', hours: 8, note: 'Walked the full length.' } });
  assert.equal(m.status, 200);
  const claims = await S.call('PUT', '/api/projects/P-002/periods/2026-04/claims', { cookie: carlo, body: { claims: [{ lineKey: 'pccp', claimedPct: 30 }] } });
  assert.equal(claims.status, 200);
  const p = (await S.call('GET', '/api/projects/P-002', { cookie: carlo })).json;
  assert.ok(p.monitoring.some((x) => x.kind === 'Progress claim entered for the contractor'));
  const monday = (await S.call('GET', '/api/review/monday', { cookie: C['rev-benita'] })).json;
  assert.ok(monday.credit.find((c) => c.uid === 'eng-carlo').hours >= 17);
});

test('the meta endpoint reports the brand and that readers are mock', async () => {
  const m = (await S.call('GET', '/api/meta')).json;
  assert.equal(m.productName, 'Proof of Progress');
  assert.equal(m.brand, 'Cernen');
  assert.equal(m.aiMode, 'mock');
  assert.equal(m.phrases.mockReader, 'Demo, not a model result');
});
