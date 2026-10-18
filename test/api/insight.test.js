// Public evidence and under-the-hood pages: numbers come from the eval files; no sign-in needed;
// the call log keeps at most 20 events and only the listed fields.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer } = require('../helpers');
const calllog = require('../../src/ai/calllog');

const EVAL = path.join(__dirname, '..', '..', 'eval');
const r2 = JSON.parse(fs.readFileSync(path.join(EVAL, 'R2_2026-10-17T2215.json'), 'utf8'));
const st = JSON.parse(fs.readFileSync(path.join(EVAL, 'reuse_stress_2026-10-18.json'), 'utf8'));

let S;
test.before(async () => {
  S = await startServer();
});
test.after(async () => S.close());

test('/api/evidence returns the numbers from the eval files', async () => {
  const r = await S.call('GET', '/api/evidence');
  assert.equal(r.status, 200);
  const a = r.json.agreement;
  const m = r2.metrics;
  assert.equal(a.referenceLines, m.referenceLines);
  assert.equal(a.referenceContradicted, m.referenceContradicted);
  assert.deepEqual(a.acceptEveryLine, m.acceptEveryLine);
  assert.deepEqual(a.geminiDefault, m.geminiDefault);
  assert.deepEqual(a.readerA, m.readerA);
  assert.deepEqual(a.readerB, m.readerB);
  assert.deepEqual(a.timing, r2.timing);
  // The figures the page states, as they stand in the current files.
  assert.deepEqual([a.acceptEveryLine.agrees, a.geminiDefault.agrees, a.readerA.agrees, a.readerB.agrees, a.referenceLines], [17, 20, 22, 18, 28]);
  assert.deepEqual([a.acceptEveryLine.overclaimsCaught, a.geminiDefault.overclaimsCaught, a.referenceContradicted], [0, 4, 7]);
  const s = r.json.stress;
  assert.equal(s.editedCopies.caught, st.editedCopies.caught);
  assert.equal(s.editedCopies.of, st.editedCopies.of);
  assert.equal(s.differentMonthsNotMatched.count, st.differentMonthsNotMatched.count);
  assert.deepEqual(s.cropsCaught, st.cropsCaught);
  assert.match(r.json.caveats, /a provisional reference, not ground truth\. One run\./);
  assert.equal(r.json.latency.text, 'one live run, 8.4 s for two lines');
  assert.equal(r.json.filesUrl, 'https://github.com/cernenhq/builder-cup-2026/tree/main/eval');
  assert.equal(r.json.rows, undefined);
});

test('/evidence and /hood pages open without sign-in, with the product name filled in', async () => {
  for (const p of ['/evidence', '/hood']) {
    const r = await S.call('GET', p);
    assert.equal(r.status, 200, p);
    assert.doesNotMatch(r.text, /\{\{(PRODUCT_NAME|BASE)\}\}/, p);
  }
  const h = await S.call('GET', '/api/hood');
  assert.equal(h.status, 200);
  assert.ok(Array.isArray(h.json.calls));
  assert.ok('spend' in h.json);
  if (h.json.spend) assert.doesNotMatch(h.json.spend.note, /bill/i);
});

test('the call log keeps the latest 20 and only the listed fields', () => {
  calllog.clear();
  for (let i = 0; i < 25; i++) {
    calllog.push({
      kind: 'reader', reader: 'A', model: 'gemini-3.8-flash', ms: 1000 + i, lines: 2, msPerLine: 500,
      usage: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 3, extra: 1 }, usd: 0.001,
      prompt: 'SECRET PROMPT', photo: 'data:image/jpeg;base64,xxxx', workspaceId: 'ws_123', error: i === 24 ? 'boom detail' : undefined
    });
  }
  const got = calllog.recent();
  assert.equal(got.length, 20);
  assert.equal(got[0].ms, 1024);
  assert.equal(got[19].ms, 1005);
  assert.deepEqual(Object.keys(got[0]).sort(), ['at', 'error', 'kind', 'lines', 'model', 'ms', 'msPerLine', 'reader', 'tokens', 'usd']);
  assert.deepEqual(got[0].tokens, { prompt: 10, output: 5, thinking: 3 });
  assert.equal(got[0].error, true);
  assert.equal(got[1].error, false);
  const text = JSON.stringify(got);
  for (const s of ['SECRET', 'base64', 'ws_123', 'boom']) assert.ok(!text.includes(s), s);
  calllog.clear();
});
