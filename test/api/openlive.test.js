// OPEN_LIVE=1 (the service in the submission form): the app's own live flows need no code, but the
// prototype's free-form Gemini endpoint still does.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers');

let S;
test.before(async () => {
  S = await startServer({ LIVE_AI: '1', MOCK_AI: '', GOOGLE_CLOUD_PROJECT: 'test-project', JUDGE_CODE: 'test-code', OPEN_LIVE: '1' });
});
test.after(async () => S.close());

test('open live: meta reports live access without a code', async () => {
  const r = await S.call('GET', '/api/meta');
  assert.equal(r.status, 200);
  assert.equal(r.json.access.judge, true);
  assert.equal(r.json.access.open, true);
  assert.equal(r.json.access.code, false);
});

test('open live: the prototype endpoint still refuses without the code', async () => {
  const r = await S.call('POST', '/api/proto/gemini', { body: { kind: 'report draft', parts: [{ text: 'hi' }] } });
  assert.equal(r.status, 403);
});
