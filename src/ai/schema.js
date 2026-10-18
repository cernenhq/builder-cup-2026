// Structured-output schema for the line verdicts. Mirrors the prototype's gemini.js VERDICT_SCHEMA,
// with one addition: photo_index says which of the period's photos the box is drawn on.
const VERDICTS = ['supported', 'contradicted', 'not_assessable'];
const CONFIDENCE = ['low', 'medium', 'high'];

// Written with the Gemini API's OpenAPI-style type names, which @google/genai accepts as responseSchema.
const VERDICT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          claim_id: { type: 'STRING' },
          question: { type: 'STRING' },
          verdict: { type: 'STRING', enum: VERDICTS },
          confidence: { type: 'STRING', enum: CONFIDENCE },
          reason: { type: 'STRING' },
          box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } },
          photo_index: { type: 'INTEGER' }
        },
        required: ['claim_id', 'question', 'verdict', 'confidence', 'reason']
      }
    }
  },
  required: ['findings']
};

// Same check the prototype ran on every response: every finding names a known claim and a
// verdict from the fixed list. Anything else is rejected and shown as "no answer".
function validateFindings(findings, claimIds) {
  if (!Array.isArray(findings)) return { ok: false, error: 'Model output had no findings list.' };
  const known = new Set(claimIds);
  for (const f of findings) {
    if (!f || !known.has(f.claim_id)) return { ok: false, error: `Model output named an unknown line (${f && f.claim_id}).` };
    if (!VERDICTS.includes(f.verdict)) return { ok: false, error: `Model output used a verdict outside the fixed list (${f.verdict}).` };
    if (f.confidence && !CONFIDENCE.includes(f.confidence)) return { ok: false, error: 'Model output used an unknown confidence level.' };
    if (f.box_2d && (!Array.isArray(f.box_2d) || f.box_2d.length !== 4 || f.box_2d.some((v) => typeof v !== 'number' || v < 0 || v > 1000))) {
      f.box_2d = null; // a bad box is dropped, the verdict is kept
    }
  }
  return { ok: true };
}

// The schema for one request: claim_id may only be one of the IDs sent in that request.
function verdictSchemaFor(claimIds) {
  const s = JSON.parse(JSON.stringify(VERDICT_SCHEMA));
  s.properties.findings.items.properties.claim_id = { type: 'STRING', enum: [...new Set(claimIds.map(String))] };
  return s;
}

module.exports = { VERDICTS, CONFIDENCE, VERDICT_SCHEMA, verdictSchemaFor, validateFindings };
