// The Cloud Vision web check, exercised with a stubbed client (no network, nothing paid).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createVision, savedOnly, sha256 } = require('../../src/ai/vision');

const buffer = fs.readFileSync(path.join(__dirname, '..', '..', 'seed-photos', 'p11.jpg'));
const photo = { id: 'p', fileName: 'p11.jpg' };

function memStore() {
  const m = new Map();
  return {
    m,
    async get(name, id) {
      return m.get(`${name}/${id}`) || null;
    },
    async set(name, id, doc) {
      m.set(`${name}/${id}`, doc);
    }
  };
}

function stubClient(reply) {
  const calls = [];
  return {
    calls,
    async request(req) {
      calls.push(req);
      if (reply instanceof Error) throw reply;
      return { data: { responses: [{ webDetection: reply }] } };
    }
  };
}

function stubSpend(ok = true) {
  const s = { reserved: 0, settled: 0 };
  s.reserve = async (kind, amount) => {
    if (!ok) return null;
    s.reserved += 1;
    return { kind, amount };
  };
  s.settle = async () => {
    s.settled += 1;
  };
  return s;
}

function make(reply, { spendOk = true, recordShared = false } = {}) {
  const client = stubClient(reply);
  const store = memStore();
  const rootStore = memStore();
  const spend = stubSpend(spendOk);
  const vision = createVision({ config: { vision: true, recordShared }, rootStore, store, spend, client });
  return { vision, client, store, rootStore, spend };
}

test('off unless VISION is set', () => {
  assert.equal(createVision({ config: { vision: false } }), null);
});

test('a full match on the web is a flag for review, with page hosts only', async () => {
  const t = make({
    fullMatchingImages: [{ url: 'https://img.example.com/a.jpg' }],
    pagesWithMatchingImages: [{ url: 'https://www.news.example.org/story/1' }, { url: 'https://blog.example.net/p?x=1' }, { url: 'https://third.example.com/' }]
  });
  const f = await t.vision.check(photo, buffer, { live: true });
  assert.equal(f.key, 'web');
  assert.equal(f.level, 'flag');
  assert.equal(f.title, 'Found online: the same image appears on 3 web pages');
  assert.match(f.detail, /news\.example\.org, blog\.example\.net\./);
  assert.doesNotMatch(f.detail, /third\.example\.com|story|https/);
  assert.match(f.detail, /A flag for review, not proof\. It may be a public reference photo\./);
  assert.equal(t.client.calls.length, 1);
  const req = t.client.calls[0];
  assert.equal(req.url, 'https://vision.googleapis.com/v1/images:annotate');
  assert.equal(req.method, 'POST');
  assert.equal(req.timeout, 30000);
  assert.deepEqual(req.data.requests[0].features, [{ type: 'WEB_DETECTION', maxResults: 5 }]);
  assert.ok(req.data.requests[0].image.content.length > 100);
  assert.equal(t.spend.reserved, 1);
  assert.equal(t.spend.settled, 1);
  // Saved in the visitor's store, keyed by the sha256 of the original bytes.
  const saved = await t.store.get('visioncache', sha256(buffer));
  assert.ok(saved && saved.result && saved.at);
  assert.equal(await t.rootStore.get('visioncache', sha256(buffer)), null);
});

test('only similar images is info', async () => {
  const t = make({ visuallySimilarImages: [{ url: 'https://x.example.com/1.jpg' }] });
  const f = await t.vision.check(photo, buffer, { live: true });
  assert.equal(f.level, 'info');
  assert.equal(f.title, 'Similar images online, no exact match');
});

test('nothing found is ok', async () => {
  const t = make({});
  const f = await t.vision.check(photo, buffer, { live: true });
  assert.equal(f.level, 'ok');
  assert.equal(f.title, 'Not found online (Google web detection)');
});

test('without the judge code and no saved result, no call is made', async () => {
  const t = make({ fullMatchingImages: [{ url: 'https://a.example.com/x.jpg' }] });
  const f = await t.vision.check(photo, buffer, { live: false });
  assert.equal(f.level, 'info');
  assert.equal(f.title, 'Web search not run');
  assert.equal(f.detail, 'Checking the web needs the judge access code.');
  assert.equal(t.client.calls.length, 0);
  assert.equal(t.spend.reserved, 0);
});

test('a saved result is replayed without a call (visitor store, then shared saved results)', async () => {
  const t = make({ fullMatchingImages: [{ url: 'https://a.example.com/x.jpg' }] });
  await t.rootStore.set('visioncache', sha256(buffer), { id: sha256(buffer), at: '2026-10-18T00:00:00.000Z', result: {} });
  const f = await t.vision.check(photo, buffer, { live: true });
  assert.equal(f.level, 'ok');
  assert.equal(f.source, 'saved');
  assert.equal(t.client.calls.length, 0);
  await t.store.set('visioncache', sha256(buffer), { id: sha256(buffer), at: '2026-10-18T01:00:00.000Z', result: { pagesWithMatchingImages: [{ url: 'https://p.example.com/' }] } });
  const g = await savedOnly(t.vision).check(photo, buffer);
  assert.equal(g.level, 'flag');
  assert.equal(t.client.calls.length, 0);
});

test('a failed call is shown as unavailable, never thrown', async () => {
  const t = make(new Error('PERMISSION_DENIED'));
  const f = await t.vision.check(photo, buffer, { live: true });
  assert.equal(f.level, 'info');
  assert.equal(f.title, 'Web search unavailable');
  assert.equal(t.spend.settled, 1, 'the reservation is settled even when the call fails');
  assert.equal(await t.store.get('visioncache', sha256(buffer)), null);
});

test('no call when the daily cap refuses the reservation', async () => {
  const t = make({ fullMatchingImages: [{ url: 'https://a.example.com/x.jpg' }] }, { spendOk: false });
  const f = await t.vision.check(photo, buffer, { live: true });
  assert.equal(f.level, 'info');
  assert.equal(f.title, 'Web search unavailable');
  assert.equal(t.client.calls.length, 0);
});

test('the recording script saves live results to the shared store', async () => {
  const t = make({}, { recordShared: true });
  await t.vision.check(photo, buffer, { live: true });
  assert.ok(await t.rootStore.get('visioncache', sha256(buffer)));
  assert.equal(await t.store.get('visioncache', sha256(buffer)), null);
});

test('with VISION on, seeded checks carry the web finding and seeding makes no live call', async () => {
  const os = require('os');
  const { build } = require('../../src/server');
  const { runInWs, MAIN } = require('../../src/workspace');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pop-vision-test-'));
  try {
    const b = await build({ NODE_ENV: 'test', STORE: 'memory', PHOTOS: 'local', PHOTO_DIR: dir, MOCK_AI: '1', WORKSPACES: '0', SEED: 'reset', VISION: '1' });
    assert.ok(b.vision);
    const per = await runInWs(MAIN, () => b.store.get('periods', 'P-003__2026-05'));
    const web = per.check.photoChecks[0].findings.find((f) => f.key === 'web');
    assert.ok(web, 'web finding present');
    assert.ok(['flag', 'info', 'ok'].includes(web.level));
    if (!web.source) assert.equal(web.title, 'Web search not run');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
