// Cloud Translation of the public progress note (optional, TRANSLATE=1).
// One request to the Cloud Translation v3 REST API per note, made with the service's own identity
// (google-auth-library, no key). Every call is checked first:
// - size: at most MAX_CHARS characters per request, else refused before anything is reserved;
// - cost: an estimate (characters x USD_PER_M_CHARS / 1e6) is reserved on the shared daily ledger
//   (src/ai/spend.js) before the call and settled with the same estimate afterwards; no reservation,
//   no call;
// - cache: results are kept by sha256(target + JSON of texts). Notes built from the seeded demo are the
//   same for every visitor, so those go to the shared store; notes from a visitor's own copy stay in
//   that copy.
// Test hook: with TRANSLATE_STUB=1 (or NODE_ENV=test), and never when NODE_ENV=production, a
// deterministic stub client is used that returns each text prefixed with "TL: ". No network call.
const crypto = require('crypto');
const { als, TEMPLATE } = require('../workspace');

const MAX_CHARS = 6000;
const USD_PER_M_CHARS = 20;
const TIMEOUT_MS = 20000;
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const COLLECTION = 'translatecache';

function plainError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const UNAVAILABLE = 'Machine translation is not available right now. The English note is the official text and is shown above.';
const AT_LIMIT = 'Machine translation has reached its daily limit. The English note is the official text and is shown above.';

// Deterministic stub used by tests: no network, same output every time.
function stubTranslateClient() {
  return {
    async request({ data }) {
      return { data: { translations: data.contents.map((t) => ({ translatedText: `TL: ${t}` })) } };
    }
  };
}

function stubEnabled(env = process.env) {
  if (env.NODE_ENV === 'production') return false;
  return env.TRANSLATE_STUB === '1' || env.NODE_ENV === 'test';
}

const cacheKey = (target, texts) => crypto.createHash('sha256').update(target + JSON.stringify(texts)).digest('hex');

function createTranslator({ config, rootStore, store, spend, client } = {}) {
  const stub = !client && stubEnabled();
  let clientPromise = client ? Promise.resolve(client) : stub ? Promise.resolve(stubTranslateClient()) : null;
  function getClient() {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { GoogleAuth } = require('google-auth-library');
        return new GoogleAuth({ scopes: [SCOPE] }).getClient();
      })();
      clientPromise.catch(() => {
        clientPromise = null;
      });
    }
    return clientPromise;
  }

  async function readCache(key) {
    for (const s of [store, rootStore]) {
      if (!s) continue;
      try {
        const hit = await s.get(COLLECTION, key);
        if (hit && Array.isArray(hit.texts)) return hit.texts;
      } catch (e) {
        // A cache read that fails is treated as a miss.
      }
    }
    return null;
  }

  async function writeCache(key, target, texts) {
    const ctx = als.getStore();
    const shared = ctx && ctx.ws === TEMPLATE;
    const s = shared ? rootStore : store || rootStore;
    if (!s) return;
    try {
      await s.set(COLLECTION, key, { target, texts, at: new Date().toISOString() });
    } catch (e) {
      // The translation is still returned; it is just not kept.
    }
  }

  async function callApi(texts, target) {
    const project = config.gcpProject || (stub || client ? 'local' : '');
    if (!project) throw plainError(UNAVAILABLE, 503);
    const url = `https://translation.googleapis.com/v3/projects/${encodeURIComponent(project)}/locations/global:translateText`;
    const data = { contents: texts, targetLanguageCode: target, sourceLanguageCode: 'en', mimeType: 'text/plain' };
    const c = await getClient();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('translation timed out')), TIMEOUT_MS);
    });
    try {
      const res = await Promise.race([c.request({ url, method: 'POST', data, timeout: TIMEOUT_MS }), timeout]);
      const out = res && res.data && Array.isArray(res.data.translations) ? res.data.translations.map((t) => (t && typeof t.translatedText === 'string' ? t.translatedText : null)) : null;
      if (!out || out.length !== texts.length || out.some((t) => t === null)) throw new Error('unexpected translation response');
      return out;
    } finally {
      clearTimeout(timer);
    }
  }

  // texts: array of strings; target: language code ('tl'). Returns the translated strings in order.
  async function translate(texts, target = 'tl') {
    if (!Array.isArray(texts) || texts.some((t) => typeof t !== 'string')) throw plainError('Texts to translate must be a list of strings.', 400);
    if (!texts.length) return [];
    const chars = texts.reduce((n, t) => n + t.length, 0);
    if (chars > MAX_CHARS) throw plainError(`This note is too long for machine translation (more than ${MAX_CHARS} characters). The English note is the official text.`, 413);
    const key = cacheKey(target, texts);
    const cached = await readCache(key);
    if (cached && cached.length === texts.length) return cached;

    const estimate = (chars * USD_PER_M_CHARS) / 1e6;
    const ticket = spend ? await spend.reserve('translate', estimate) : null;
    if (!ticket) throw plainError(AT_LIMIT, 503);
    let out;
    try {
      out = await callApi(texts, target);
    } catch (e) {
      try {
        await spend.settle(ticket, estimate);
      } catch (e2) {
        // The reservation stays counted.
      }
      throw plainError(UNAVAILABLE, 503);
    }
    try {
      await spend.settle(ticket, estimate);
    } catch (e) {
      // The reservation stays counted.
    }
    await writeCache(key, target, out);
    return out;
  }

  return { translate, stub };
}

module.exports = { createTranslator, cacheKey, stubEnabled, MAX_CHARS, USD_PER_M_CHARS, TIMEOUT_MS };
