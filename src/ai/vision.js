// Cloud Vision web detection (optional, VISION=1): "Has this site photo appeared online?"
// One more rule check per photo. Results are cached by the sha256 of the original photo bytes: first
// the visitor's own store, then the shared saved results (src/seed/saved-runs.json, key 'visioncache').
// A live call needs the judge access code (live = true) and a reservation under the daily cap.
// Never throws: any problem becomes an 'info' finding.
const crypto = require('crypto');
const sharp = require('sharp');

const ENDPOINT = 'https://vision.googleapis.com/v1/images:annotate';
const COST_USD = 0.0035; // our estimate per WEB_DETECTION image
const TIMEOUT_MS = 30000;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch (e) {
    return null;
  }
}

// Keep only what the finding needs, so saved results stay small.
function trim(web) {
  const w = web || {};
  const urls = (a) => (Array.isArray(a) ? a.map((x) => ({ url: x && x.url })).filter((x) => x.url) : []);
  return {
    fullMatchingImages: urls(w.fullMatchingImages),
    partialMatchingImages: urls(w.partialMatchingImages),
    pagesWithMatchingImages: urls(w.pagesWithMatchingImages),
    visuallySimilarImages: urls(w.visuallySimilarImages)
  };
}

function webFinding(result, meta = {}) {
  const w = trim(result);
  const extra = { source: meta.source || null, savedAt: meta.at || null };
  const full = w.fullMatchingImages;
  const pages = w.pagesWithMatchingImages;
  if (full.length || pages.length) {
    const list = pages.length ? pages : full;
    const hosts = [...new Set(list.map((x) => hostOf(x.url)).filter(Boolean))].slice(0, 2);
    const n = list.length;
    return {
      key: 'web',
      level: 'flag',
      title: `Found online: the same image appears on ${n} web page${n === 1 ? '' : 's'}`,
      detail: `${hosts.length ? `Seen on ${hosts.join(', ')}. ` : ''}A flag for review, not proof. It may be a public reference photo.`,
      matches: n,
      hosts,
      ...extra
    };
  }
  if (w.partialMatchingImages.length || w.visuallySimilarImages.length) {
    return {
      key: 'web',
      level: 'info',
      title: 'Similar images online, no exact match',
      detail: 'Google web detection found visually similar images but not this photo. Similar views of a site are common.',
      ...extra
    };
  }
  return { key: 'web', level: 'ok', title: 'Not found online (Google web detection)', detail: 'No matching image on indexed web pages. Images not indexed by Google are not covered.', ...extra };
}

const NOT_RUN = { key: 'web', level: 'info', title: 'Web search not run', detail: 'Checking the web needs the judge access code.' };
const UNAVAILABLE = { key: 'web', level: 'info', title: 'Web search unavailable', detail: 'The web check could not be completed. The other checks are unaffected.' };

function createVision({ config, rootStore, store, spend, client: injected } = {}) {
  if (!config || !config.vision) return null;
  let clientP = injected ? Promise.resolve(injected) : null;
  const getClient = () => {
    if (!clientP) {
      const { GoogleAuth } = require('google-auth-library');
      clientP = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
      clientP.catch(() => {
        clientP = null;
      });
    }
    return clientP;
  };

  async function cached(id) {
    try {
      const own = store ? await store.get('visioncache', id) : null;
      if (own) return own;
      return rootStore ? await rootStore.get('visioncache', id) : null;
    } catch (e) {
      return null;
    }
  }

  return {
    kind: 'cloud-vision',
    async check(photo, buffer, { live } = {}) {
      try {
        if (!buffer || !buffer.length) return { ...UNAVAILABLE };
        const id = sha256(buffer);
        const hit = await cached(id);
        if (hit) return webFinding(hit.result, { source: 'saved', at: hit.at });
        if (!live || !spend) return { ...NOT_RUN };
        const ticket = await spend.reserve('vision', COST_USD);
        if (!ticket) return { ...UNAVAILABLE, detail: "Today's limit for web checks has been reached. The other checks are unaffected." };
        let result;
        try {
          const jpg = await sharp(buffer).rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
          const client = await getClient();
          const res = await client.request({
            url: ENDPOINT,
            method: 'POST',
            timeout: TIMEOUT_MS,
            data: { requests: [{ image: { content: jpg.toString('base64') }, features: [{ type: 'WEB_DETECTION', maxResults: 5 }] }] }
          });
          const r0 = res && res.data && Array.isArray(res.data.responses) ? res.data.responses[0] : null;
          if (!r0 || r0.error) throw new Error((r0 && r0.error && r0.error.message) || 'empty response');
          result = trim(r0.webDetection);
        } finally {
          await spend.settle(ticket, COST_USD).catch(() => {});
        }
        const doc = { id, at: new Date().toISOString(), result };
        const target = config.recordShared ? rootStore : store;
        try {
          if (target) await target.set('visioncache', id, doc);
        } catch (e) {
          // Not saved; the finding is still shown.
        }
        return webFinding(result, { source: 'live', at: doc.at });
      } catch (e) {
        return { ...UNAVAILABLE };
      }
    }
  };
}

// Seeding and other no-live paths: same cache, never a live call.
function savedOnly(vision) {
  if (!vision) return null;
  return { ...vision, check: (photo, buffer) => vision.check(photo, buffer, { live: false }) };
}

module.exports = { createVision, savedOnly, webFinding, sha256, COST_USD };
