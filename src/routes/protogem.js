// Live Gemini for the interactive prototype (/prototype): the page's Gemini buttons call this instead of
// Google directly, so there is no key in the browser. Vertex AI is called with the service's identity.
// Guarded like every other live call: the judge access code, a fixed list of request kinds, size limits,
// a server-side output limit, and a reservation under the daily cap before the call.
const { GoogleGenAI } = require('@google/genai');
const { maxUsd, estimateUsd } = require('../ai/spend');
const calllog = (() => {
  try {
    return require('../ai/calllog');
  } catch (e) {
    return null;
  }
})();

// kind -> what it may send and get back
const KINDS = {
  'line verdicts': { images: 1, out: 8000 },
  'period compare': { images: 2, out: 4000 },
  'watch camera': { images: 6, out: 4000 },
  'report draft': { images: 0, out: 2000 },
  'finished look (AI image)': { images: 1, out: 0, image: true }
};
const MAX_TEXT_BYTES = 12000;
const MAX_IMAGE_BYTES = 2_500_000; // base64 characters per image
const TOKENS_PER_PHOTO_MAX = 2000;
const IMAGE_CALL_RESERVE_USD = 0.2;

module.exports = function registerProtoGemini(app, { wrap, config, spend }) {
  let ai = null;
  const client = () => {
    if (!ai) ai = new GoogleGenAI({ vertexai: true, project: config.gcpProject, location: config.gcpLocation || 'global' });
    return ai;
  };

  app.post('/api/proto/gemini', wrap(async (req, res) => {
    if (config.ai === 'mock' || !config.gcpProject) return res.status(503).json({ error: { message: 'Live Gemini is off on this deployment. The prototype replays recorded results.' } });
    if (!req.judge) return res.status(403).json({ error: { message: 'Live Gemini needs the judge access code: enter it on the sign-in page (Judges and organisers), then come back.' } });
    const b = req.body || {};
    const kind = String(b.kind || '');
    const k = KINDS[kind];
    if (!k) return res.status(400).json({ error: { message: 'Unknown request kind.' } });
    const parts = Array.isArray(b.parts) ? b.parts : [];
    const texts = parts.filter((p) => typeof p.text === 'string');
    const images = parts.filter((p) => p.inline_data || p.inlineData);
    const textBytes = texts.reduce((n, p) => n + Buffer.byteLength(p.text, 'utf8'), 0);
    if (textBytes > MAX_TEXT_BYTES) return res.status(400).json({ error: { message: 'Request too long.' } });
    if (images.length > k.images) return res.status(400).json({ error: { message: `This request takes at most ${k.images} image(s).` } });
    const cleanParts = [];
    for (const p of parts) {
      if (typeof p.text === 'string') cleanParts.push({ text: p.text });
      else if (p.inline_data || p.inlineData) {
        const d = p.inline_data || p.inlineData;
        const mime = String(d.mime_type || d.mimeType || '');
        const data = String(d.data || '');
        if (!/^image\/(jpeg|png|webp)$/.test(mime) || data.length > MAX_IMAGE_BYTES || !/^[A-Za-z0-9+/=]+$/.test(data)) return res.status(400).json({ error: { message: 'Images must be JPEG, PNG or WebP and under 1.8 MB.' } });
        cleanParts.push({ inlineData: { mimeType: mime, data } });
      }
    }
    const gen = b.gen || {};
    const model = k.image ? config.imageModel : config.geminiModel;
    if (!model) return res.status(503).json({ error: { message: 'No image model is configured on this deployment.' } });
    const cfg = { temperature: typeof gen.temperature === 'number' ? Math.max(0, Math.min(1, gen.temperature)) : 0.2 };
    if (gen.responseMimeType === 'application/json') cfg.responseMimeType = 'application/json';
    if (gen.responseSchema && typeof gen.responseSchema === 'object' && JSON.stringify(gen.responseSchema).length < 4000) cfg.responseSchema = gen.responseSchema;
    if (k.image) cfg.responseModalities = ['TEXT', 'IMAGE'];
    else cfg.maxOutputTokens = k.out;
    const reserveUsd = k.image ? IMAGE_CALL_RESERVE_USD : maxUsd(model, textBytes + JSON.stringify(cfg).length + images.length * TOKENS_PER_PHOTO_MAX, k.out);
    const ticket = spend ? await spend.reserve(`proto ${kind}`, reserveUsd) : null;
    if (!ticket) return res.status(429).json({ error: { message: "Today's live AI budget for the demo is used up, or its ledger could not be written. Please try again later." } });
    const t0 = Date.now();
    let usd = null;
    try {
      const r = await Promise.race([
        client().models.generateContent({ model, contents: [{ role: 'user', parts: cleanParts }], config: cfg }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 120 s')), 120000))
      ]);
      const ms = Date.now() - t0;
      usd = k.image ? IMAGE_CALL_RESERVE_USD : estimateUsd(model, r.usageMetadata);
      const ev = { kind: `prototype: ${kind}`, model, ms, usage: r.usageMetadata || null, usd };
      if (calllog && calllog.push) calllog.push(ev);
      if (process.env.NODE_ENV !== 'test') console.log(JSON.stringify({ severity: 'INFO', message: 'gemini_call', ...ev }));
      // Same shape as the Gemini REST reply the page already reads.
      const out = (r.candidates || []).map((c) => ({ content: { parts: ((c.content && c.content.parts) || []).map((p) => (p.inlineData ? { inlineData: { mimeType: p.inlineData.mimeType, data: p.inlineData.data } } : { text: p.text || '' })) } }));
      res.json({ candidates: out, usageMetadata: r.usageMetadata || null, model });
    } catch (e) {
      res.status(502).json({ error: { message: `The model call failed: ${String(e.message || e).slice(0, 200)}` } });
    } finally {
      if (spend) await spend.settle(ticket, usd);
    }
  }));
};
