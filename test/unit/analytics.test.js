// BigQuery analytics with a stubbed client: no live call to Google.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAnalytics, BQ_SCHEMA, copyIdOf } = require('../../src/services/analytics');
const { runInWs } = require('../../src/workspace');

const CFG = { bqDataset: 'pop', bqTable: 'events', gcpProject: 'demo-proj' };

function stubClient(handler) {
  const calls = [];
  return {
    calls,
    async request(opts) {
      calls.push(opts);
      return handler ? handler(opts, calls.length) : { data: {} };
    }
  };
}

function captureLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (s) => lines.push(String(s));
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = orig;
    })
    .then(() => lines);
}

const check = (n) => ({
  runAt: '2026-10-18T01:00:00.000Z',
  aiMode: 'mock',
  models: { A: 'gemini-x', B: 'gemini-y' },
  runBy: { uid: 'u1', name: 'Ana Cruz', role: 'engineer' },
  lines: Array.from({ length: n }, (_, i) => ({ lineKey: `l${i}`, label: 'Label', statement: 'free text', aiDefault: 'supported', readers: { A: { verdict: 'supported' }, B: { verdict: 'not_assessable' } } }))
});

test('schema is flat and all NULLABLE', () => {
  assert.equal(BQ_SCHEMA.length, 14);
  assert.ok(BQ_SCHEMA.every((c) => c.mode === 'NULLABLE' && ['TIMESTAMP', 'STRING', 'BOOL'].includes(c.type)));
  assert.equal(BQ_SCHEMA.find((c) => c.name === 'overrode').type, 'BOOL');
});

test('record when disabled is a no-op', async () => {
  const a = createAnalytics({ bqDataset: '' });
  assert.equal(a.enabled, false);
  assert.doesNotThrow(() => a.record('check', { project: { id: 'P' }, period: '2026-05', check: check(3) }));
  assert.equal(await a.summary(), null);
});

test('check rows are batched and flushed at 50 rows, one row per line, no names or free text', async () => {
  const client = stubClient();
  const a = createAnalytics(CFG, { client, flushMs: 60000 });
  runInWs('ws-abc', () => a.record('check', { project: { id: 'P-001', name: 'Road' }, period: '2026-05', check: check(30) }));
  assert.equal(client.calls.length, 0, 'not sent before the batch fills');
  runInWs('ws-abc', () => a.record('check', { project: { id: 'P-001' }, period: '2026-05', check: check(25) }));
  await a.flush();
  assert.equal(client.calls.length, 1);
  const call = client.calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.url, 'https://bigquery.googleapis.com/bigquery/v2/projects/demo-proj/datasets/pop/tables/events/insertAll');
  assert.equal(call.data.rows.length, 55);
  const r = call.data.rows[0];
  assert.ok(r.insertId);
  assert.deepEqual(Object.keys(r.json).sort(), BQ_SCHEMA.map((c) => c.name).sort());
  assert.equal(r.json.kind, 'check_line');
  assert.equal(r.json.copy_id, copyIdOf('ws-abc'));
  assert.match(r.json.copy_id, /^[0-9a-f]{12}$/);
  assert.equal(r.json.reader_b, 'not_assessable');
  assert.equal(r.json.model, 'gemini-x');
  const text = JSON.stringify(call.data);
  assert.ok(!text.includes('Ana Cruz') && !text.includes('free text') && !text.includes('Road') && !text.includes('ws-abc'));
  a.stop();
});

test('timer flush sends a small batch; decision rows carry decision, overrode and role only', async () => {
  const client = stubClient();
  const a = createAnalytics(CFG, { client, flushMs: 20 });
  a.record('decision', {
    project: { id: 'P-003' },
    decision: { period: '2026-05', lineKey: 'cb', aiMode: 'mock', readerA: 'supported', readerB: 'contradicted', aiDefault: 'disagree', decision: 'supported', overrode: true, reason: 'secret reason', by: { uid: 'u', name: 'Benita', role: 'reviewer' }, at: '2026-10-18T02:00:00.000Z' }
  });
  await new Promise((r) => setTimeout(r, 60));
  await a.flush();
  assert.equal(client.calls.length, 1);
  const j = client.calls[0].data.rows[0].json;
  assert.equal(j.kind, 'decision');
  assert.equal(j.decision, 'supported');
  assert.equal(j.overrode, true);
  assert.equal(j.decided_by_role, 'reviewer');
  assert.equal(j.event_time, '2026-10-18T02:00:00.000Z');
  assert.ok(!JSON.stringify(j).includes('secret reason') && !JSON.stringify(j).includes('Benita'));
});

test('insert failure is logged as one WARNING line, not thrown, and retried at most twice', async () => {
  const client = stubClient(() => {
    throw new Error('permission denied');
  });
  const a = createAnalytics(CFG, { client, flushMs: 60000 });
  const lines = await captureLog(async () => {
    assert.doesNotThrow(() => a.record('check', { project: { id: 'P' }, period: '2026-05', check: check(2) }));
    await a.flush();
  });
  assert.equal(client.calls.length, 3, 'one try plus two retries');
  const warns = lines.map((l) => JSON.parse(l)).filter((o) => o.severity === 'WARNING');
  assert.equal(warns.length, 1);
  assert.equal(warns[0].message, 'bq_insert_failed');
});

test('record never throws on odd input', () => {
  const a = createAnalytics(CFG, { client: stubClient(), flushMs: 60000 });
  assert.doesNotThrow(() => a.record('check', null));
  assert.doesNotThrow(() => a.record('unknown', { x: 1 }));
  assert.doesNotThrow(() => a.record('check', { check: { lines: [null] } }));
  a.stop();
});

const QUERY_RESPONSE = {
  jobComplete: true,
  rows: [
    ['decision', 'supported', '7'],
    ['decision', 'contradicted', '2'],
    ['overrode', null, '3'],
    ['matched_default', null, '6'],
    ['decisions', null, '9'],
    ['copies', null, '4'],
    ['check_line', 'supported', '20'],
    ['check_line', 'disagree', '5']
  ].map((r) => ({ f: r.map((v) => ({ v })) }))
};

test('summary parses a query response into numbers and caches it for 5 minutes', async () => {
  let t = 1000000;
  const client = stubClient(() => ({ data: QUERY_RESPONSE }));
  const a = createAnalytics(CFG, { client, now: () => t });
  const s = await a.summary();
  assert.equal(client.calls.length, 1);
  const q = client.calls[0];
  assert.equal(q.url, 'https://bigquery.googleapis.com/bigquery/v2/projects/demo-proj/queries');
  assert.equal(q.data.useLegacySql, false);
  assert.equal(q.data.timeoutMs, 10000);
  assert.match(q.data.query, /INTERVAL 7 DAY/);
  assert.match(q.data.query, /`demo-proj\.pop\.events`/);
  assert.deepEqual(s.decisionsByOutcome, { supported: 7, contradicted: 2 });
  assert.equal(s.decisions, 9);
  assert.equal(s.overrides, 3);
  assert.equal(s.matchedAiDefault, 6);
  assert.equal(s.matchedShare, 0.667);
  assert.equal(s.copies, 4);
  assert.equal(s.checkLines, 25);
  assert.deepEqual(s.checkLinesByAiDefault, { supported: 20, disagree: 5 });

  t += 4 * 60 * 1000;
  assert.deepEqual(await a.summary(), s);
  assert.equal(client.calls.length, 1, 'cache avoids a second query');
  t += 2 * 60 * 1000;
  await a.summary();
  assert.equal(client.calls.length, 2, 'cache expires after 5 minutes');
});

test('summary returns null on error', async () => {
  const client = stubClient(() => {
    throw new Error('boom');
  });
  const a = createAnalytics(CFG, { client });
  const lines = await captureLog(async () => assert.equal(await a.summary(), null));
  assert.equal(JSON.parse(lines[0]).severity, 'WARNING');
});
