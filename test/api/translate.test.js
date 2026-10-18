// Public note in Filipino: route on (with the deterministic TRANSLATE_STUB client) and off.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers');

test('TRANSLATE=1: translated note keeps numbers, months and the project id; labelled as machine translation', async () => {
  const prev = process.env.TRANSLATE_STUB;
  process.env.TRANSLATE_STUB = '1';
  const S = await startServer({ TRANSLATE: '1' });
  try {
    const en = (await S.call('GET', '/api/public/projects/P-001')).json;
    const r = await S.call('GET', '/api/public/projects/P-001/note?lang=tl');
    assert.equal(r.status, 200);
    assert.equal(r.json.lang, 'tl');
    assert.match(r.json.label, /Machine translation/);
    const n = r.json.note;
    assert.equal(n.projectId, en.projectId);
    assert.deepEqual(n.percent, en.percent);
    assert.equal(n.photoPeriod, en.photoPeriod);
    assert.equal(n.name, `TL: ${en.name}`);
    assert.equal(n.explainer, `TL: ${en.explainer}`);
    assert.deepEqual(n.notVisible, en.notVisible.map((s) => `TL: ${s}`));
    assert.deepEqual(n.photosShow, en.photosShow.map((s) => ({ text: `TL: ${s.text}`, month: s.month })));
    assert.deepEqual(r.json.headings, { photosShowHeading: 'TL: What the photos show', notVisibleHeading: 'TL: Not visible in the photos, or not yet confirmed', completeLabel: 'TL: complete' });
    assert.equal((await S.call('GET', '/api/public/projects/NOPE/note?lang=tl')).status, 404);
    assert.equal((await S.call('GET', '/api/public/projects/P-001/note?lang=fr')).status, 400);
    // The English note is unchanged.
    assert.deepEqual((await S.call('GET', '/api/public/projects/P-001')).json, en);
  } finally {
    await S.close();
    if (prev === undefined) delete process.env.TRANSLATE_STUB;
    else process.env.TRANSLATE_STUB = prev;
  }
});

test('TRANSLATE off: the route answers 404', async () => {
  const S = await startServer({ TRANSLATE: '' });
  try {
    assert.equal((await S.call('GET', '/api/public/projects/P-001/note?lang=tl')).status, 404);
    assert.equal((await S.call('GET', '/api/public/projects/P-001')).status, 200);
  } finally {
    await S.close();
  }
});
