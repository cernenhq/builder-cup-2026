// Saved Gemini answers replay for everyone; a live call needs the judge code and stays under the cap.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore } = require('../../src/store/memory');
const { createCachedReaders } = require('../../src/ai/cached');
const { createSpendGuard, estimateUsd } = require('../../src/ai/spend');
const { draftNote } = require('../../src/services/notes');

const input = { periodLabel: 'April 2026', claims: [{ id: 'Q1', statement: 'Roof waterproofing: 100%', question: 'q', hidden: true }], photos: [{ id: 'p', buffer: Buffer.from('photo') }], photoLabels: ['p'] };

function fakeLive() {
  const calls = [];
  return {
    calls,
    mode: 'gemini',
    async resolveModel() {
      return 'gemini-test';
    },
    async read(reader) {
      calls.push(reader);
      return { mode: 'gemini', model: 'gemini-test', ok: true, findings: [{ claim_id: 'Q1', verdict: 'not_assessable' }], ms: 5, usd: 0.01 };
    },
    async write() {
      calls.push('write');
      return { ok: true, text: 'Draft note text.', model: 'gemini-test', usd: 0.005 };
    }
  };
}

test('without the code: no live call; with it: one live call, then replayed as saved for everyone', async () => {
  const root = createMemoryStore();
  const live = fakeLive();
  let judge = false;
  const spend = createSpendGuard({ rootStore: root, capUsd: 3, dayFn: () => '2026-10-18' });
  const r = createCachedReaders({ live, rootStore: root, spend, canSpend: async () => judge });
  const first = await r.read('A', input);
  assert.equal(first.mode, 'needs_code');
  assert.equal(live.calls.length, 0);
  judge = true;
  const second = await r.read('A', input);
  assert.equal(second.mode, 'gemini');
  assert.equal(live.calls.length, 1);
  judge = false;
  const third = await r.read('A', input);
  assert.equal(third.mode, 'saved');
  assert.equal(live.calls.length, 1);
  assert.ok(Math.abs((await spend.today()) - 0.01) < 1e-9);
});

test('the daily cap stops live calls even with the code', async () => {
  const root = createMemoryStore();
  const live = fakeLive();
  const spend = createSpendGuard({ rootStore: root, capUsd: 0.1, dayFn: () => '2026-10-18' });
  const r = createCachedReaders({ live, rootStore: root, spend, canSpend: async () => true });
  const out = await r.read('B', input);
  assert.equal(out.mode, 'needs_code');
  assert.equal(out.capReached, true);
  assert.equal(live.calls.length, 0);
});

test('the cap holds under 40 simultaneous live requests; nothing is lost when they settle together', async () => {
  const root = createMemoryStore();
  let started = 0;
  const slowLive = {
    mode: 'gemini',
    async resolveModel() {
      return 'gemini-test';
    },
    async read(reader, inp) {
      started++;
      await new Promise((res) => setTimeout(res, 20));
      return { mode: 'gemini', model: 'gemini-test', ok: true, findings: [{ claim_id: inp.claims[0].id, verdict: 'supported' }], ms: 20, usd: 0.05 };
    }
  };
  const spend = createSpendGuard({ rootStore: root, capUsd: 1, dayFn: () => '2026-10-18' });
  const r = createCachedReaders({ live: slowLive, rootStore: root, spend, canSpend: async () => true });
  // 40 different inputs, so none is answered from the saved cache.
  const inputs = Array.from({ length: 40 }, (_, i) => ({ ...input, claims: [{ ...input.claims[0], id: `Q${i}` }] }));
  const res = await Promise.all(inputs.map((inp) => r.read('A', inp)));
  // Reservation 0.14 each: at most 7 calls fit under US$1 at once; the rest are refused.
  assert.equal(started, 7);
  assert.equal(res.filter((x) => x.capReached).length, 33);
  const st = await spend.state();
  assert.equal(st.reserved, 0);
  assert.ok(Math.abs(st.spent - 7 * 0.05) < 1e-9, `spent ${st.spent}`);
  assert.equal(st.calls, 7);
  // With the room freed, later calls fit again until the cap: (1 - 0.35) / 0.14 = 4 more at once.
  started = 0;
  const more = Array.from({ length: 10 }, (_, i) => ({ ...input, claims: [{ ...input.claims[0], id: `R${i}` }] }));
  await Promise.all(more.map((inp) => r.read('A', inp)));
  assert.equal(started, 4);
  assert.ok((await spend.state()).spent <= 1);
});

test('a failed or timed-out call keeps its full reservation as spent', async () => {
  const root = createMemoryStore();
  const failing = { mode: 'gemini', async resolveModel() { return 'gemini-test'; }, async read() { return { mode: 'gemini', ok: false, error: 'timed out' }; } };
  const spend = createSpendGuard({ rootStore: root, capUsd: 3, dayFn: () => '2026-10-18' });
  const r = createCachedReaders({ live: failing, rootStore: root, spend, canSpend: async () => true });
  await r.read('A', input);
  assert.ok(Math.abs((await spend.state()).spent - 0.14) < 1e-9);
});

test('the reservation is stored before the call; if the ledger cannot be written, no paid call is made', async () => {
  const root = createMemoryStore();
  const live = fakeLive();
  const spend = createSpendGuard({ rootStore: root, capUsd: 3, dayFn: () => '2026-10-18' });
  const r = createCachedReaders({ live, rootStore: root, spend, canSpend: async () => true });
  // During the call, the stored ledger already holds the reservation.
  let seenDuringCall = null;
  live.read = async () => {
    seenDuringCall = await root.get('spend', 'day_2026-10-18');
    return { mode: 'gemini', model: 'gemini-test', ok: true, findings: [{ claim_id: 'Q1', verdict: 'not_assessable' }], usd: 0.01 };
  };
  await r.read('A', input);
  assert.ok(seenDuringCall && Math.abs(seenDuringCall.reserved - 0.14) < 1e-9);
  // A ledger that cannot be written refuses the call.
  const broken = createMemoryStore();
  broken.transact = async () => {
    throw new Error('write failed');
  };
  const live2 = fakeLive();
  const spend2 = createSpendGuard({ rootStore: broken, capUsd: 3, dayFn: () => '2026-10-18' });
  const r2 = createCachedReaders({ live: live2, rootStore: broken, spend: spend2, canSpend: async () => true });
  const out = await r2.read('A', { ...input, claims: [{ ...input.claims[0], id: 'Z' }] });
  assert.equal(out.capReached, true);
  assert.equal(live2.calls.length, 0);
});

test('after a restart, open reservations in the store count as spent', async () => {
  const root = createMemoryStore();
  await root.set('spend', 'day_2026-10-18', { usd: 2.8, reserved: 0.15, calls: 40 });
  const spend = createSpendGuard({ rootStore: root, capUsd: 3, dayFn: () => '2026-10-18' });
  assert.equal(await spend.reserve('reader', 0.14), null);
  assert.ok(await spend.reserve('note', 0.02));
});

test('after a restart the guard starts from the stored total', async () => {
  const root = createMemoryStore();
  await root.set('spend', 'day_2026-10-18', { usd: 2.95, calls: 40 });
  const spend = createSpendGuard({ rootStore: root, capUsd: 3, dayFn: () => '2026-10-18' });
  assert.equal(await spend.reserve('reader', 0.14), null);
  assert.ok(await spend.reserve('note', 0.02));
});

test('spend estimate uses token counts', () => {
  assert.ok(Math.abs(estimateUsd('gemini-3.8-flash', { promptTokenCount: 1e6, candidatesTokenCount: 0 }) - 1.5) < 1e-9);
});

test('draft note: decisions only, needs the code unless a saved draft matches', async () => {
  const root = createMemoryStore();
  const ws = root.scope('main');
  const project = { id: 'P-9', name: 'Demo hall (demo)' };
  await ws.set('periods', 'P-9__2026-04', { projectId: 'P-9', period: '2026-04', percentComplete: { value: 70 }, check: { lines: [{ lineKey: 'wp', label: 'Roof waterproofing', claimedPct: 100 }, { lineKey: 'gc', label: 'Ground floor columns', claimedPct: 100 }] } });
  const live = fakeLive();
  const base = { store: ws, rootStore: root, live, spend: null, config: { ai: 'vertex', geminiModel: 'gemini-test' }, project, period: '2026-04', audience: 'mayor' };
  await assert.rejects(draftNote({ ...base, judge: true }), /Decide at least one line/);
  await ws.set('decisions', 'd1', { kind: 'line', projectId: 'P-9', period: '2026-04', lineKey: 'wp', decision: 'not_assessable', reason: 'Hidden work', at: '2026-05-05T00:00:00Z' });
  await assert.rejects(draftNote({ ...base, judge: false }), (e) => e.needsCode === true);
  const made = await draftNote({ ...base, judge: true });
  assert.equal(made.saved, false);
  assert.equal(made.text, 'Draft note text.');
  const replay = await draftNote({ ...base, judge: false });
  assert.equal(replay.saved, true);
  assert.equal(live.calls.filter((c) => c === 'write').length, 1);
});

test('two instances sharing one ledger cannot both pass the cap', async () => {
  const root = createMemoryStore();
  const a = createSpendGuard({ rootStore: root, capUsd: 0.14, dayFn: () => '2026-10-18' });
  const b = createSpendGuard({ rootStore: root, capUsd: 0.14, dayFn: () => '2026-10-18' });
  const [ta, tb] = await Promise.all([a.reserve('reader', 0.14), b.reserve('reader', 0.14)]);
  assert.equal([ta, tb].filter(Boolean).length, 1);
  await a.settle(ta || tb, 0.1);
  const st = await b.state();
  assert.ok(Math.abs(st.spent - 0.1) < 1e-9 && st.reserved === 0);
});

test('live calls over the size limits are refused before anything is reserved', async () => {
  const { createGeminiReaders, MAX_TEXT_PER_LINE, MAX_PROMPT_BYTES, TOKENS_PER_PHOTO_MAX, SCHEMA_BYTES, MAX_OUTPUT_TOKENS_READER } = require('../../src/ai/gemini');
  const { maxUsd } = require('../../src/ai/spend');
  const g = createGeminiReaders({ client: { models: { generateContent: async () => ({ text: '{}' }) } }, model: 'gemini-3.8-flash' });
  const long = { ...input, claims: [{ id: 'Q1', statement: 'x'.repeat(MAX_TEXT_PER_LINE + 1), question: 'q' }] };
  assert.equal((await g.estimateRead('A', long)).ok, false);
  // Non-English and hard-to-compress text: the reservation counts UTF-8 bytes, so a line of
  // three-byte characters reserves at least three tokens per character.
  const wide = { ...input, claims: [{ id: 'Q1', statement: '\u6f22'.repeat(250), question: '\u{1F9F1}'.repeat(60) }] };
  const w = await g.estimateRead('A', wide);
  assert.ok(w.ok, w.error);
  const minTokens = Buffer.byteLength('\u6f22'.repeat(250)) + Buffer.byteLength('\u{1F9F1}'.repeat(60)) + SCHEMA_BYTES + TOKENS_PER_PHOTO_MAX;
  assert.ok(w.maxUsd >= maxUsd('gemini-3.8-flash', minTokens, MAX_OUTPUT_TOKENS_READER) - 1e-12);
  // Twenty lines of wide characters go over the byte limit and are refused, not under-reserved.
  const many = { ...input, claims: Array.from({ length: 20 }, (_, i) => ({ id: `Q${i}`, statement: '\u6f22'.repeat(290), question: '\u6f22'.repeat(290) })) };
  assert.equal((await g.estimateRead('A', many)).ok, false);
  // The largest reservation the limits allow, stated in the README.
  const worst = maxUsd('gemini-3.8-flash', MAX_PROMPT_BYTES + SCHEMA_BYTES + 4 * TOKENS_PER_PHOTO_MAX, MAX_OUTPUT_TOKENS_READER);
  assert.ok(worst < 0.17, `worst ${worst}`);
});

test('a check that finishes after the claims changed stays stale', async () => {
  const { createMemoryStore: mk } = require('../../src/store/memory');
  const { runCheck } = require('../../src/services/check');
  const { setClaims } = require('../../src/services/actions');
  const ws = mk().scope('main');
  const project = { id: 'P-9', name: 'Demo (demo)', lines: [{ key: 'ab', label: 'Line AB' }], site: null };
  await setClaims({ store: ws, project, period: '2026-04', claims: [{ lineKey: 'ab', claimedPct: 50, statement: 'old', question: 'q' }], user: { id: 'u', name: 'U', role: 'engineer' }, source: 'office' });
  await ws.set('photos', 'ph1', { id: 'ph1', projectId: 'P-9', period: '2026-04', storageKey: 'k', createdAt: '2026-04-01T00:00:00Z', source: 'office', exif: {}, phash: '0', phashMirror: '0' });
  let release;
  const gate = new Promise((r) => (release = r));
  const slowReaders = { mode: 'gemini', async read() { await gate; return { mode: 'gemini', ok: true, findings: [] }; } };
  const photoStore = { async get() { return { buffer: Buffer.from('x') }; } };
  const running = runCheck({ store: ws, photoStore, readers: slowReaders, project, period: '2026-04', user: { id: 'u', name: 'U', role: 'engineer' } });
  await new Promise((r) => setTimeout(r, 10));
  await setClaims({ store: ws, project, period: '2026-04', claims: [{ lineKey: 'ab', claimedPct: 90, statement: 'NEW', question: 'q' }], user: { id: 'u', name: 'U', role: 'engineer' }, source: 'office' });
  release();
  await running;
  const per = await ws.get('periods', 'P-9__2026-04');
  assert.equal(per.checkStale, true);
  assert.match(per.checkStaleReason, /while the check was running/);
});
