// The live Gemini adapter, exercised with a stubbed client (no key or network in tests).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createGeminiReaders } = require('../../src/ai/gemini');
const { VERDICT_SCHEMA } = require('../../src/ai/schema');

const photo = { id: 'p', buffer: fs.readFileSync(path.join(__dirname, '..', '..', 'seed-photos', 'p11.jpg')) };
const input = { periodLabel: 'May 2026', claims: [{ id: 'Q071', statement: 'Street hoarding replacement: 100%', question: 'The street hoarding is green.' }], corrections: [], photos: [photo], photoLabels: ['p11.jpg'] };

function stub(reply) {
  const calls = [];
  return {
    calls,
    models: {
      async generateContent(req) {
        calls.push(req);
        if (reply instanceof Error) throw reply;
        return { text: JSON.stringify(reply), usageMetadata: { totalTokenCount: 10 } };
      },
      async list() {
        return (async function* () {
          yield { name: 'models/gemini-3.6-flash', supportedActions: ['generateContent'] };
        })();
      }
    }
  };
}

test('sends one structured-output request with the schema and the photo inline', async () => {
  const c = stub({ findings: [{ claim_id: 'Q071', question: 'q', verdict: 'supported', confidence: 'high', reason: 'Green hoarding along the street.', box_2d: [760, 0, 960, 1000] }] });
  const r = await createGeminiReaders({ client: c }).read('A', input);
  assert.equal(r.ok, true);
  assert.equal(r.model, 'gemini-3.6-flash', 'model picked from the key when GEMINI_MODEL is unset');
  const req = c.calls[0];
  assert.equal(req.config.responseMimeType, 'application/json');
  // Same schema, except claim_id is limited to the IDs sent in this request.
  assert.deepEqual(req.config.responseSchema.properties.findings.items.properties.claim_id, { type: 'STRING', enum: ['Q071'] });
  assert.deepEqual(req.config.responseSchema.properties.findings.items.required, VERDICT_SCHEMA.properties.findings.items.required);
  assert.match(req.contents[0].parts[0].text, /claim_id Q071/);
  assert.match(req.contents[0].parts[0].text, /exact value after "claim_id" \(one of: Q071\)/);
  assert.equal(req.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.match(req.contents[0].parts[0].text, /Q071/);
});

test('output outside the fixed verdict list is rejected and shown as no answer', async () => {
  const r = await createGeminiReaders({ client: stub({ findings: [{ claim_id: 'Q071', question: 'q', verdict: 'probably fine', confidence: 'high', reason: 'x' }] }), model: 'm' }).read('B', input);
  assert.equal(r.ok, false);
  assert.match(r.error, /no answer/);
});

test('a failed call is reported, not thrown', async () => {
  const r = await createGeminiReaders({ client: stub(new Error('quota')), model: 'm' }).read('A', input);
  assert.equal(r.ok, false);
  assert.match(r.error, /quota/);
});
