// Cloud Translation of the public note: stubbed client only, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore } = require('../../src/store/memory');
const { createSpendGuard } = require('../../src/ai/spend');
const { createTranslator, MAX_CHARS, cacheKey } = require('../../src/ai/translate');
const { runInWs, TEMPLATE } = require('../../src/workspace');

const config = { gcpProject: 'demo-project' };

function stubClient({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async request(req) {
      calls.push(req);
      if (fail) throw new Error('network down');
      return { data: { translations: req.data.contents.map((t) => ({ translatedText: `[tl] ${t}` })) } };
    }
  };
}

function setup(opts = {}) {
  const root = createMemoryStore();
  const visitor = root.scope('v1');
  const spend = opts.spend || createSpendGuard({ rootStore: root, capUsd: opts.cap ?? 3, dayFn: () => '2026-10-18' });
  const client = stubClient(opts);
  const tr = createTranslator({ config, rootStore: root, store: visitor, spend, client });
  return { root, visitor, spend, client, tr };
}

test('translates every text in one request with the v3 request shape, and records the estimate', async () => {
  const { tr, client, spend } = setup();
  const out = await tr.translate(['Roof waterproofing', 'What the photos show'], 'tl');
  assert.deepEqual(out, ['[tl] Roof waterproofing', '[tl] What the photos show']);
  assert.equal(client.calls.length, 1);
  const req = client.calls[0];
  assert.equal(req.method, 'POST');
  assert.equal(req.url, 'https://translation.googleapis.com/v3/projects/demo-project/locations/global:translateText');
  assert.deepEqual(req.data, { contents: ['Roof waterproofing', 'What the photos show'], targetLanguageCode: 'tl', sourceLanguageCode: 'en', mimeType: 'text/plain' });
  const st = await spend.state();
  assert.equal(st.reserved, 0);
  assert.equal(st.calls, 1);
  assert.ok(Math.abs(st.spent - (38 * 20) / 1e6) < 1e-9);
});

test('a cache hit avoids a second call', async () => {
  const { tr, client } = setup();
  await tr.translate(['Same text'], 'tl');
  const again = await tr.translate(['Same text'], 'tl');
  assert.deepEqual(again, ['[tl] Same text']);
  assert.equal(client.calls.length, 1);
});

test('seeded-demo notes are cached on the shared store; a visitor copy keeps its own', async () => {
  const { tr, root, visitor } = setup();
  await runInWs(TEMPLATE, () => tr.translate(['Shared note'], 'tl'));
  assert.ok(await root.get('translatecache', cacheKey('tl', ['Shared note'])));
  assert.equal(await visitor.get('translatecache', cacheKey('tl', ['Shared note'])), null);
  await runInWs('v1', () => tr.translate(['Own note'], 'tl'));
  assert.ok(await visitor.get('translatecache', cacheKey('tl', ['Own note'])));
  assert.equal(await root.get('translatecache', cacheKey('tl', ['Own note'])), null);
});

test('no reservation (daily cap reached): no call, plain 503', async () => {
  const spend = { reserve: async () => null, settle: async () => assert.fail('nothing to settle') };
  const { tr, client } = setup({ spend });
  await assert.rejects(tr.translate(['Hello'], 'tl'), (e) => e.status === 503 && /daily limit/.test(e.message));
  assert.equal(client.calls.length, 0);
});

test('over the size limit: refused before anything is reserved', async () => {
  let reserved = 0;
  const spend = { reserve: async () => (reserved++, { amount: 1, day: 'd' }), settle: async () => {} };
  const { tr, client } = setup({ spend });
  await assert.rejects(tr.translate(['x'.repeat(MAX_CHARS + 1)], 'tl'), (e) => e.status === 413);
  assert.equal(reserved, 0);
  assert.equal(client.calls.length, 0);
});

test('an error from the service: plain 503, reservation settled, nothing cached', async () => {
  const { tr, client, spend, visitor } = setup({ fail: true });
  await assert.rejects(tr.translate(['Hello'], 'tl'), (e) => e.status === 503 && /English note/.test(e.message));
  assert.equal(client.calls.length, 1);
  const st = await spend.state();
  assert.equal(st.reserved, 0);
  assert.equal(st.calls, 1);
  assert.equal(await visitor.get('translatecache', cacheKey('tl', ['Hello'])), null);
});
