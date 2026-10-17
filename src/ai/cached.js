// Readers in front of the live model.
// - Saved seed runs (recorded once with scripts/record-runs.js, shared by everyone) replay when the same
//   photos and claimed lines come back. They were recorded without reviewer corrections; the answer says so.
// - Answers generated during a visit are kept only in that visitor's own copy (it expires with the copy),
//   keyed on everything that shapes the prompt, corrections and photo labels included.
// - A new live call needs the judge access code and room under the daily cap (src/ai/spend.js).
const crypto = require('crypto');

// Key of the shared seed runs: model, reader, period, claimed lines and photo bytes.
function inputKey(model, reader, input) {
  const h = crypto.createHash('sha256');
  h.update(`${model}|${reader}|${input.periodLabel}|`);
  for (const c of input.claims) h.update(`${c.id}|${c.statement || ''}|${c.question || ''}|${c.hidden ? 1 : 0};`);
  for (const p of input.photos) h.update(crypto.createHash('sha256').update(p.buffer).digest('hex'));
  return h.digest('hex').slice(0, 40);
}

// Key of a visitor's own answers: the seed key plus every other prompt input.
function fullKey(model, reader, input) {
  const h = crypto.createHash('sha256');
  h.update(inputKey(model, reader, input));
  h.update(JSON.stringify({ labels: input.photoLabels || [], corrections: input.corrections || [] }));
  return `v_${h.digest('hex').slice(0, 40)}`;
}

// live: the Gemini readers. store: the visitor's workspace store (answers generated in that copy).
// canSpend(): whether this request may make a live call (judge access code). spend: the daily guard.
// shareLive: write new answers to the shared seed runs instead (scripts/record-runs.js only).
function createCachedReaders({ live, rootStore, store, spend, canSpend, shareLive = false }) {
  const own = store || rootStore;
  async function read(reader, input) {
    const model = await live.resolveModel();
    const seedKey = inputKey(model, reader, input);
    const visitKey = fullKey(model, reader, input);
    const mine = await own.get('aicache', visitKey);
    if (mine) return { ...mine.result, mode: 'saved', savedAt: mine.at };
    const seed = await rootStore.get('aicache', seedKey);
    if (seed) return { ...seed.result, mode: 'saved', savedAt: seed.at, recordedWithoutCorrections: (input.corrections || []).length > 0 };
    if (!(await canSpend())) return { mode: 'needs_code', model, ok: false, error: 'The AI reading needs the judge access code.' };
    // Size limits first, then reserve the most this call can cost.
    const est = live.estimateRead ? await live.estimateRead(reader, input) : { ok: true, maxUsd: 0.14 };
    if (!est.ok) return { mode: 'gemini', model, ok: false, error: est.error };
    const ticket = spend ? await spend.reserve('reader', est.maxUsd) : { amount: 0 };
    if (!ticket) return { mode: 'needs_code', model, ok: false, capReached: true, error: "Today's live AI budget for the demo is used up, or its ledger could not be written. Saved runs still work; please try again later." };
    let r;
    try {
      r = await live.read(reader, input);
    } finally {
      if (spend) await spend.settle(ticket, r && r.usd);
    }
    if (r.ok) {
      const doc = { at: new Date().toISOString(), result: { model: r.model, ok: true, findings: r.findings, ms: r.ms } };
      if (shareLive) await rootStore.set('aicache', seedKey, { id: seedKey, ...doc });
      else await own.set('aicache', visitKey, { id: visitKey, ...doc });
    }
    return r;
  }
  return { mode: 'gemini', read, resolveModel: live.resolveModel, write: live.write, estimateWrite: live.estimateWrite };
}

module.exports = { createCachedReaders, inputKey, fullKey };
