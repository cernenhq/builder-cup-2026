// The prototype's Gemini endpoint: refused without the access code, only known kinds, size limits.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers');

let S;
let judge;
test.before(async () => {
  S = await startServer({ LIVE_AI: '1', MOCK_AI: '', GOOGLE_CLOUD_PROJECT: 'test-project', JUDGE_CODE: 'test-code' });
  const r = await fetch(`${S.base}/api/access`, { method: 'POST', headers: { 'x-pop-request': '1', 'content-type': 'application/json' }, body: JSON.stringify({ code: 'test-code' }) });
  judge = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
});
test.after(async () => S.close());

test('no access code: refused before any model call', async () => {
  const r = await S.call('POST', '/api/proto/gemini', { body: { kind: 'report draft', parts: [{ text: 'hi' }] } });
  assert.equal(r.status, 403);
  assert.match(r.json.error.message, /access code/);
});

test('with the code: unknown kinds, too many images and oversized text are refused before any call', async () => {
  assert.equal((await S.call('POST', '/api/proto/gemini', { cookie: judge, body: { kind: 'anything', parts: [{ text: 'hi' }] } })).status, 400);
  const img = { inline_data: { mime_type: 'image/jpeg', data: 'AAAA' } };
  assert.equal((await S.call('POST', '/api/proto/gemini', { cookie: judge, body: { kind: 'line verdicts', parts: [{ text: 'x' }, img, img] } })).status, 400);
  assert.equal((await S.call('POST', '/api/proto/gemini', { cookie: judge, body: { kind: 'report draft', parts: [{ text: 'x'.repeat(13000) }] } })).status, 400);
  const bad = { inline_data: { mime_type: 'text/html', data: 'AAAA' } };
  assert.equal((await S.call('POST', '/api/proto/gemini', { cookie: judge, body: { kind: 'line verdicts', parts: [{ text: 'x' }, bad] } })).status, 400);
});
