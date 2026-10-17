const test = require('node:test');
const assert = require('node:assert/strict');
const { questionFor, combine, pctFromStatement } = require('../../src/domain/lines');
const { plannedAt, slippage, overdueMilestones } = require('../../src/domain/progress');
const { escalations } = require('../../src/domain/escalation');
const { buildDrafts, toText, toCsv, toHtml } = require('../../src/domain/reports');
const { validateFindings } = require('../../src/ai/schema');
const { promptFor } = require('../../src/ai/prompt');
const { findBanned, neutralize } = require('../../src/domain/wording');

const line = { key: 're', label: 'Rooftop enclosure', q: { partial: 'partly enclosed', done: 'fully enclosed', none: 'not enclosed' } };

test('each claim line becomes one question a photo can answer, never a percentage', () => {
  assert.equal(questionFor(line, 100), 'fully enclosed');
  assert.equal(questionFor(line, 40), 'partly enclosed');
  assert.equal(questionFor(line, 0), 'not enclosed');
  assert.match(questionFor({ key: 'x', label: 'Concrete pavement' }, 60), /visible but not finished/);
  assert.match(questionFor({ key: 'rw', label: 'Roof waterproofing', hidden: true }, 100), /hidden work/);
  assert.equal(pctFromStatement('Main entrance canopy: 70%'), 70);
  assert.equal(pctFromStatement('Tower crane demobilisation: not done'), 0);
  assert.equal(pctFromStatement('Mobile crane hire: on site'), 100);
});

test("hidden work is always can't tell, whatever a reader says", () => {
  const r = combine({ hidden: true }, { verdict: 'supported' }, { verdict: 'contradicted' });
  assert.equal(r.aiDefault, 'not_assessable');
  assert.equal(r.hiddenRule, true);
});

test('two readers: agreement gives a default, disagreement gives none and says so', () => {
  assert.equal(combine(line, { verdict: 'supported' }, { verdict: 'supported' }).aiDefault, 'supported');
  const d = combine(line, { verdict: 'supported' }, { verdict: 'contradicted' });
  assert.equal(d.aiDefault, 'disagree');
  assert.equal(d.agree, false);
  assert.match(d.note, /disagree/);
  assert.equal(combine(line, null, { verdict: 'contradicted' }).agree, null);
  assert.equal(combine(line, null, null).aiDefault, 'no_answer');
});

test('model output is held to the fixed verdict list', () => {
  assert.equal(validateFindings([{ claim_id: 'Q1', verdict: 'supported', confidence: 'high' }], ['Q1']).ok, true);
  assert.equal(validateFindings([{ claim_id: 'Q1', verdict: 'probably' }], ['Q1']).ok, false);
  assert.equal(validateFindings([{ claim_id: 'Q9', verdict: 'supported' }], ['Q1']).ok, false);
  const bad = [{ claim_id: 'Q1', verdict: 'supported', box_2d: [1, 2, 3] }];
  assert.equal(validateFindings(bad, ['Q1']).ok, true);
  assert.equal(bad[0].box_2d, null, 'a malformed box is dropped, the verdict kept');
});

test('prompts carry the hidden-work rule and no accusatory words; reader B is told to read independently', () => {
  const input = { periodLabel: 'May 2026', claims: [{ id: 'Q1', statement: 's', question: 'q' }], corrections: [{ lineLabel: 'Canopy', ai: 'supported', decision: 'contradicted', reason: 'bare frame' }], photoLabels: ['p11.jpg'] };
  const a = promptFor('A', input);
  const b = promptFor('B', input);
  for (const p of [a, b]) {
    assert.match(p, /hidden work/i);
    assert.deepEqual(findBanned(p), []);
    assert.match(p, /Canopy: the readers said supported, the reviewer decided contradicted/);
  }
  assert.match(b, /independent/);
});

test('model wording is neutralised before anyone sees it', () => {
  const word = ['fra', 'ud'].join('');
  assert.equal(findBanned(neutralize(`Looks like ${word}ulent work`)).length, 0);
});

const project = { id: 'P', name: 'Road', location: 'Somewhere', contractor: 'C (fictional)', contractId: 'X', contractAmount: 1000000, startDate: '2026-01-01', milestones: [{ pct: 50, due: '2026-03-01' }, { pct: 100, due: '2026-05-01' }], lines: [line], fictional: true };

test('planned percent, slippage and overdue milestones', () => {
  assert.equal(plannedAt(project, '2026-01-01'), 0);
  assert.equal(plannedAt(project, '2026-03-01'), 50);
  assert.equal(plannedAt(project, '2026-04-01'), 75.4);
  const s = slippage(project, { value: 60, asOf: '2026-03-31' }, '2026-06-01');
  assert.equal(s.points, -14.6);
  const ms = overdueMilestones(project, { value: 60 }, '2026-06-01');
  assert.deepEqual(ms.map((m) => m.pct), [100]);
});

const cfg = { reportOverdueDays: 7, milestoneOverdueDays: 30, contradictedLines: 2, laggingPoints: 5 };
const snapBase = { project: { id: 'P', name: 'Road' }, inChargeName: 'X', obligations: [], overdueMilestones: [], confirmedContradicted: null, slippage: null, pendingReview: 0, openPhotoFlags: 0, missingContractorReport: null };

test('fuel gauge: yellow to the office first, red (mayor) only past the thresholds', () => {
  const ob = (days) => escalations({ ...snapBase, obligations: [{ kind: 'COA', periodKey: '2026-05', due: '2026-06-05', status: 'overdue', daysOverdue: days }] }, cfg)[0].level;
  assert.equal(ob(3), 1);
  assert.equal(ob(7), 2);
  const con = (n) => escalations({ ...snapBase, confirmedContradicted: { period: '2026-04', count: n, lines: [] } }, cfg)[0].level;
  assert.equal(con(1), 1);
  assert.equal(con(2), 2);
  const ms = (d) => escalations({ ...snapBase, overdueMilestones: [{ pct: 40, due: '2026-03-31', daysOverdue: d, actual: 35 }] }, cfg)[0].level;
  assert.equal(ms(10), 1);
  assert.equal(ms(30), 2);
  // Lagging, late-but-submitted reports and items waiting for review never reach the mayor.
  const office = escalations({ ...snapBase, slippage: { points: -25, actual: 35, planned: 60, asOf: '2026-04-30' }, pendingReview: 4, obligations: [{ kind: 'COA', periodKey: '2026-04', due: '2026-05-08', status: 'late', daysLate: 4, recent: true }] }, cfg);
  assert.ok(office.length === 3 && office.every((i) => i.level === 1));
  assert.ok(office.every((i) => findBanned(i.plain).length === 0));
});

test('one percent entry fills all four drafts, in text, CSV and printable HTML', () => {
  const period = { period: '2026-05', percentComplete: { value: 70, enteredBy: 'u', enteredByName: 'Ana', enteredAt: '2026-06-01T00:00:00Z' }, check: null };
  const d = buildDrafts({ project, period, photos: [], effective: new Map(), monitoring: [], inChargeName: 'Ana', today: '2026-06-01' });
  assert.deepEqual(d.drafts.map((x) => x.kind), ['COA', 'SUBAYBAYAN', 'IAS', 'MPDO']);
  for (const x of d.drafts) {
    assert.equal(x.percent, 70);
    for (const out of [toText(x, true), toCsv(x, true), toHtml(x, true)]) {
      assert.match(out, /70%/);
      assert.match(out, /DRAFT/);
      assert.deepEqual(findBanned(out), []);
    }
  }
  assert.equal(d.drafts.find((x) => x.kind === 'SUBAYBAYAN').fields.find((f) => f[0] === 'Project status')[1], 'Ongoing');
  assert.match(d.drafts.find((x) => x.kind === 'MPDO').narrative, /is 70% complete/);
  assert.equal(d.drafts.find((x) => x.kind === 'IAS').periodKey, '2026-Q2');
});

test('CSV exports neutralise cells a spreadsheet would run as formulas', () => {
  const { csvCell } = require('../../src/domain/reports');
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-2'), "'-2");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('Visible in the photo'), 'Visible in the photo');
});
