// Reuse-check stress test on the deployed rule code (src/domain/rules.js, src/domain/imagefeatures.js).
// Free and deterministic: no model calls. For each of the 11 public frames, six edited copies are made
// and checked against the 11 originals; the 11 originals are checked against each other (different
// months must not match); and 10% and 20% crops are checked (a stated limit of the hash check).
//   node scripts/reuse-stress.js   -> prints a summary and writes eval/reuse_stress_<date>.json
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { features } = require('../src/domain/imagefeatures');
const { reuseCheck } = require('../src/domain/rules');

const DIR = path.join(__dirname, '..', 'seed-photos');
const EDITS = {
  recompressed: (s) => s.jpeg({ quality: 35 }),
  brightened: (s) => s.modulate({ brightness: 1.15 }).jpeg({ quality: 85 }),
  darkened: (s) => s.modulate({ brightness: 0.85 }).jpeg({ quality: 85 }),
  softened: (s) => s.blur(1.2).jpeg({ quality: 85 }),
  shrunk: (s) => s.resize({ width: 560 }).jpeg({ quality: 85 }),
  mirrored: (s) => s.flop().jpeg({ quality: 85 })
};

(async () => {
  const originals = [];
  for (let i = 1; i <= 11; i++) {
    const n = String(i).padStart(2, '0');
    const buf = fs.readFileSync(path.join(DIR, `p${n}.jpg`));
    originals.push({ id: `p${n}`, projectId: 'P-001', period: `frame ${n}`, ...(await features(buf)), buf });
  }
  const rows = [];
  let caught = 0;
  for (const o of originals) {
    for (const [name, fn] of Object.entries(EDITS)) {
      const buf = await fn(sharp(o.buf)).toBuffer();
      const r = reuseCheck({ id: `${o.id}-${name}`, ...(await features(buf)) }, originals);
      const ok = r.level === 'flag' && r.matchPhotoId === o.id;
      caught += ok ? 1 : 0;
      rows.push({ frame: o.id, edit: name, caught: ok, distance: r.distance ?? null, mirrored: !!r.mirrored });
    }
  }
  let monthsApart = 0;
  const distances = [];
  for (const o of originals) {
    const r = reuseCheck(o, originals.filter((x) => x.id !== o.id));
    if (r.level !== 'flag') monthsApart++;
    distances.push(Number((r.detail.match(/distance (\d+)/i) || [])[1] ?? r.distance));
  }
  const crops = { 10: 0, 20: 0 };
  for (const o of originals) {
    const meta = await sharp(o.buf).metadata();
    for (const pct of [10, 20]) {
      const dx = Math.round((meta.width * pct) / 200);
      const dy = Math.round((meta.height * pct) / 200);
      const buf = await sharp(o.buf).extract({ left: dx, top: dy, width: meta.width - 2 * dx, height: meta.height - 2 * dy }).jpeg({ quality: 85 }).toBuffer();
      const r = reuseCheck({ id: `${o.id}-crop${pct}`, ...(await features(buf)) }, originals);
      if (r.level === 'flag' && r.matchPhotoId === o.id) crops[pct]++;
    }
  }
  const out = {
    ranAt: new Date().toISOString(),
    code: 'src/domain/rules.js reuseCheck + src/domain/imagefeatures.js (as deployed)',
    editedCopies: { caught, of: rows.length, edits: Object.keys(EDITS) },
    differentMonthsNotMatched: { count: monthsApart, of: originals.length, nearestDistances: distances },
    cropsCaught: { pct10: `${crops[10]}/11`, pct20: `${crops[20]}/11` },
    rows
  };
  const day = out.ranAt.slice(0, 10);
  fs.writeFileSync(path.join(__dirname, '..', 'eval', `reuse_stress_${day}.json`), `${JSON.stringify(out, null, 1)}\n`);
  console.log(`edited copies caught: ${caught}/${rows.length} (${Object.keys(EDITS).join(', ')})`);
  console.log(`different months not matched: ${monthsApart}/11 (nearest distances ${distances.join(', ')})`);
  console.log(`crops caught: 10% ${crops[10]}/11, 20% ${crops[20]}/11`);
  const missed = rows.filter((r) => !r.caught);
  if (missed.length) console.log('missed:', missed.map((m) => `${m.frame}/${m.edit}(d=${m.distance})`).join(' '));
})();
