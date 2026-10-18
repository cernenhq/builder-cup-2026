// Live readers on Gemini via @google/genai, with structured output.
// On Cloud Run the service calls Vertex AI with its own service account (no API key anywhere).
// A GEMINI_API_KEY is still accepted for local use, never committed.
const sharp = require('sharp');
const { GoogleGenAI } = require('@google/genai');
const { VERDICT_SCHEMA, verdictSchemaFor, validateFindings } = require('./schema');
const { promptFor } = require('./prompt');
const { estimateUsd, maxUsd } = require('./spend');

// Preference order when no model is pinned; otherwise the newest general "flash" model available.
const PREFERRED = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3-flash', 'gemini-2.5-flash'];
const CALL_TIMEOUT_MS = 150000;
// Bounds that make each call's cost predictable (see RESERVE_USD in spend.js). The output limit includes
// thinking tokens; a reply cut off by it fails the schema check and shows as no answer.
const MAX_PHOTOS = 4;
const MAX_LINES = 20;
const MAX_OUTPUT_TOKENS_READER = 15000;
const MAX_OUTPUT_TOKENS_NOTE = 2000;
// Input bounds, checked before anything is reserved or sent. The input token count is bounded from above:
// - text: never more tokens than UTF-8 bytes (a tokenizer with byte fallback emits at most one token per
//   byte), counting the prompt and the response schema;
// - photos: 2,000 tokens each, above the 1,120 Google documents for Gemini 3 at the default media
//   resolution, which is what these requests use.
const MAX_TEXT_PER_LINE = 300;
const MAX_PROMPT_BYTES = 24000;
const MAX_NOTE_PROMPT_BYTES = 12000;
const TOKENS_PER_PHOTO_MAX = 2000;
const SCHEMA_BYTES = Buffer.byteLength(JSON.stringify(VERDICT_SCHEMA), 'utf8');
const bytes = (t) => Buffer.byteLength(String(t), 'utf8');

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(`timed out after ${ms / 1000} s`)), ms)))]).finally(() => clearTimeout(t));
}

// One structured line for Cloud Logging: every model call with its latency, tokens and estimated cost.
function logCall(fields) {
  require('./calllog').push(fields);
  if (process.env.NODE_ENV === 'test') return;
  console.log(JSON.stringify({ severity: 'INFO', message: 'gemini_call', ...fields }));
}

// `client` lets tests pass a stub in place of the real API client.
function createGeminiReaders({ apiKey, vertex, model, modelB, client }) {
  const ai = client || (vertex ? new GoogleGenAI({ vertexai: true, project: vertex.project, location: vertex.location || 'global' }) : new GoogleGenAI({ apiKey }));
  let resolved = model || null;

  async function resolveModel() {
    if (resolved) return resolved;
    try {
      const names = [];
      const pager = await ai.models.list({ config: { pageSize: 200 } });
      for await (const m of pager) {
        if ((m.supportedActions || []).includes('generateContent')) names.push(String(m.name).replace('models/', ''));
      }
      resolved =
        PREFERRED.find((n) => names.includes(n)) ||
        names.filter((n) => /gemini-.*flash/.test(n) && !/image|tts|audio|live|lite/.test(n)).sort().reverse()[0] ||
        'gemini-2.5-flash';
    } catch (e) {
      resolved = 'gemini-2.5-flash';
    }
    return resolved;
  }

  async function imagePart(buf) {
    // Shrink to keep requests small; the original file (with its metadata) stays in storage untouched.
    const jpg = await sharp(buf).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    return { inlineData: { mimeType: 'image/jpeg', data: jpg.toString('base64') } };
  }

  // The prompt and the most this call can cost, or a refusal when the request is over the size limits.
  async function plan(reader, input) {
    const m = reader === 'B' && modelB ? modelB : await resolveModel();
    if (input.claims.length > MAX_LINES) return { model: m, error: `A live check takes at most ${MAX_LINES} claimed lines at a time.` };
    if (input.claims.some((c) => String(c.statement || '').length > MAX_TEXT_PER_LINE || String(c.question || '').length > MAX_TEXT_PER_LINE)) {
      return { model: m, error: `Each claimed line and its question must be under ${MAX_TEXT_PER_LINE} characters for a live check.` };
    }
    const text = promptFor(reader, input);
    if (bytes(text) > MAX_PROMPT_BYTES) return { model: m, error: 'This request is too long for a live check.' };
    const photos = Math.min(MAX_PHOTOS, input.photos.length);
    const inputTokens = bytes(text) + bytes(JSON.stringify(verdictSchemaFor(input.claims.map((c) => c.id)))) + photos * TOKENS_PER_PHOTO_MAX;
    return { model: m, text, maxUsd: maxUsd(m, inputTokens, MAX_OUTPUT_TOKENS_READER) };
  }
  async function estimateRead(reader, input) {
    const p = await plan(reader, input);
    return p.error ? { ok: false, model: p.model, error: p.error } : { ok: true, model: p.model, maxUsd: p.maxUsd };
  }
  function estimateWrite(prompt) {
    if (bytes(prompt) > MAX_NOTE_PROMPT_BYTES) return { ok: false, error: 'This note request is too long.' };
    return { ok: true, maxUsd: maxUsd(resolved || model || 'unknown', bytes(prompt), MAX_OUTPUT_TOKENS_NOTE) };
  }

  async function read(reader, input) {
    const p = await plan(reader, input);
    const m = p.model;
    if (p.error) return { mode: 'gemini', model: m, ok: false, error: p.error };
    const text = p.text;
    const parts = [{ text }];
    for (const p of input.photos.slice(0, MAX_PHOTOS)) parts.push(await imagePart(p.buffer));
    const t0 = Date.now();
    try {
      const res = await withTimeout(
        ai.models.generateContent({
          model: m,
          contents: [{ role: 'user', parts }],
          config: { responseMimeType: 'application/json', responseSchema: verdictSchemaFor(input.claims.map((c) => c.id)), temperature: reader === 'B' ? 0.3 : 0.1, maxOutputTokens: MAX_OUTPUT_TOKENS_READER }
        }),
        CALL_TIMEOUT_MS
      );
      const ms = Date.now() - t0;
      const usage = res.usageMetadata || null;
      const usd = estimateUsd(m, usage);
      logCall({ kind: 'reader', reader, model: m, ms, lines: input.claims.length, msPerLine: Math.round(ms / Math.max(1, input.claims.length)), usage, usd });
      const raw = String(res.text || '').replace(/^```json\s*|```$/g, '');
      const parsed = JSON.parse(raw);
      const v = validateFindings(parsed.findings, input.claims.map((c) => c.id));
      if (!v.ok) return { mode: 'gemini', model: m, ok: false, error: `${v.error} Shown as no answer.`, ms, usage, usd };
      return { mode: 'gemini', model: m, ok: true, findings: parsed.findings, ms, usage, usd };
    } catch (e) {
      logCall({ kind: 'reader', reader, model: m, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) });
      return { mode: 'gemini', model: m, ok: false, error: `The model call failed: ${String(e.message || e).slice(0, 200)}`, ms: Date.now() - t0 };
    }
  }

  // Plain text generation (the drafted notes). Returns { ok, text, model, ms, usage, usd } or { ok: false, error }.
  async function write(prompt) {
    const m = await resolveModel();
    if (bytes(prompt) > MAX_NOTE_PROMPT_BYTES) return { ok: false, model: m, error: 'This note request is too long.' };
    const t0 = Date.now();
    try {
      const res = await withTimeout(ai.models.generateContent({ model: m, contents: [{ role: 'user', parts: [{ text: prompt }] }], config: { temperature: 0.4, maxOutputTokens: MAX_OUTPUT_TOKENS_NOTE } }), CALL_TIMEOUT_MS);
      const ms = Date.now() - t0;
      const usage = res.usageMetadata || null;
      const usd = estimateUsd(m, usage);
      logCall({ kind: 'note', model: m, ms, usage, usd });
      return { ok: true, text: String(res.text || '').trim(), model: m, ms, usage, usd };
    } catch (e) {
      logCall({ kind: 'note', model: m, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) });
      return { ok: false, model: m, error: `The model call failed: ${String(e.message || e).slice(0, 200)}` };
    }
  }

  return { mode: 'gemini', read, write, resolveModel, estimateRead, estimateWrite };
}

module.exports = { createGeminiReaders, MAX_LINES, MAX_PHOTOS, MAX_OUTPUT_TOKENS_READER, MAX_OUTPUT_TOKENS_NOTE, MAX_PROMPT_BYTES, MAX_TEXT_PER_LINE, TOKENS_PER_PHOTO_MAX, SCHEMA_BYTES };
