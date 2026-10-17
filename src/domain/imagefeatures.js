// Image features computed without any AI: a perceptual hash (and its mirrored twin) for reuse and
// flip detection, and a small edge map used to judge whether two views are comparable.
const sharp = require('sharp');

async function grayRaw(buf, w, h, mirror = false) {
  let s = sharp(buf).rotate().resize(w, h, { fit: 'fill' }).grayscale();
  if (mirror) s = s.flop();
  return s.raw().toBuffer();
}

// 63-bit DCT perceptual hash, the same method as the prototype (32x32 grey, 8x8 low frequencies,
// DC term dropped, threshold at the median). Returned as a 63-character string of 0 and 1.
const COS = (() => {
  const t = [];
  for (let u = 0; u < 8; u++) {
    t[u] = [];
    for (let i = 0; i < 32; i++) t[u][i] = Math.cos(((2 * i + 1) * u * Math.PI) / 64);
  }
  return t;
})();
function dctHash(g) {
  const c = [];
  for (let u = 0; u < 8; u++)
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let i = 0; i < 32; i++) {
        const cu = COS[u][i];
        for (let j = 0; j < 32; j++) s += g[i * 32 + j] * cu * COS[v][j];
      }
      c.push(s);
    }
  const a = c.slice(1);
  const m = [...a].sort((p, q) => p - q)[31];
  return a.map((v) => (v > m ? '1' : '0')).join('');
}
async function phash(buf, mirror = false) {
  return dctHash(await grayRaw(buf, 32, 32, mirror));
}
function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

const EW = 96;
const EH = 54;
async function edgeMap(buf) {
  const g = await grayRaw(buf, EW, EH);
  const e = new Array(EW * EH).fill(0);
  for (let y = 1; y < EH - 1; y++)
    for (let x = 1; x < EW - 1; x++) {
      const gx = g[y * EW + x + 1] - g[y * EW + x - 1];
      const gy = g[(y + 1) * EW + x] - g[(y - 1) * EW + x];
      e[y * EW + x] = Math.round(Math.hypot(gx, gy));
    }
  return e;
}
function ncc(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= a.length;
  mb /= b.length;
  let n = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? n / Math.sqrt(da * db) : 0;
}

async function features(buf) {
  const meta = await sharp(buf).metadata();
  return {
    width: meta.width,
    height: meta.height,
    phash: await phash(buf),
    phashMirror: await phash(buf, true),
    edges: await edgeMap(buf)
  };
}

module.exports = { phash, hamming, edgeMap, ncc, features };
