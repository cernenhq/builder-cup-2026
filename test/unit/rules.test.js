// Rule checks that run with no AI, tested on the real blurred public frames.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { features, hamming } = require('../../src/domain/imagefeatures');
const R = require('../../src/domain/rules');
const { SEED_PHOTOS } = require('../helpers');

const frame = (n) => fs.readFileSync(path.join(SEED_PHOTOS, `p${String(n).padStart(2, '0')}.jpg`));
const feats = {};
async function f(n) {
  if (!feats[n]) feats[n] = await features(frame(n));
  return feats[n];
}
const photo = (id, ft, extra = {}) => ({ id, projectId: 'P-001', period: '2026-02', phash: ft.phash, phashMirror: ft.phashMirror, edges: ft.edges, width: ft.width, height: ft.height, ...extra });

test('different months of the same fixed camera are not flagged as reuse', async () => {
  for (let i = 1; i <= 11; i++)
    for (let j = i + 1; j <= 11; j++) {
      const d = hamming((await f(i)).phash, (await f(j)).phash);
      assert.ok(d > R.REUSE_MAX_DISTANCE, `p${i} vs p${j} distance ${d}`);
    }
});

test('an exact or recompressed copy is flagged for review, with neutral wording', async () => {
  const recompressed = await features(await sharp(frame(8)).jpeg({ quality: 30 }).toBuffer());
  const r = R.reuseCheck(photo('new', recompressed, { projectId: 'P-003' }), [photo('orig', await f(8), { projectName: 'Building' })]);
  assert.equal(r.level, 'flag');
  assert.ok(r.distance <= 6);
  assert.match(r.detail, /A reused photo is a flag for review/);
});

test('a mirrored (flipped) copy is caught by the mirrored hash', async () => {
  const flipped = await features(await sharp(frame(8)).flop().toBuffer());
  assert.ok(hamming(flipped.phash, (await f(8)).phash) > 6, 'the plain hash misses a flip');
  const r = R.reuseCheck(photo('new', flipped), [photo('orig', await f(8))]);
  assert.equal(r.level, 'flag');
  assert.equal(r.mirrored, true);
  assert.match(r.title, /mirrored/);
});

test('known limit: a tight crop gets past the hash (documented in the README)', async () => {
  const crop = await features(await sharp(frame(8)).extract({ left: 101, top: 57, width: 918, height: 517 }).toBuffer());
  const r = R.reuseCheck(photo('new', crop), [photo('orig', await f(8))]);
  assert.equal(r.level, 'ok');
  assert.match(r.detail, /Crops can get past this check/);
});

test('printed stamp vs file date vs reporting period', () => {
  const mismatch = R.dateChecks({ stampText: '04-25-2026 Sat 16:29:12', exif: { taken: '2026-05-28T07:48' } }, '2026-04');
  const sv = mismatch.find((x) => x.key === 'stamp_vs_file');
  assert.equal(sv.level, 'flag');
  assert.match(sv.detail, /A mismatch, not proof of where or when a photo was taken/);
  assert.equal(mismatch.find((x) => x.key === 'capture_date').level, 'ok', 'stamp is inside April');

  const outside = R.dateChecks({ stampText: '05-21-2026 Thu 11:12:21', exif: null }, '2026-06');
  assert.equal(outside.find((x) => x.key === 'capture_date').level, 'flag');

  const none = R.dateChecks({ stampText: '', exif: { taken: null } }, '2026-06');
  const c = none.find((x) => x.key === 'capture_date');
  assert.equal(c.level, 'info', 'missing metadata is information, not a flag');
  assert.match(c.detail, /never required/);
});

test('stamp parser reads security-camera and ISO formats', () => {
  assert.equal(R.parseStamp('05-21-2026 Thu 11:12:21'), '2026-05-21T11:12');
  assert.equal(R.parseStamp('2026-05-21 08:30'), '2026-05-21T08:30');
  assert.equal(R.parseStamp('no date here'), null);
});

test('EXIF date and GPS are read from the file when present', async () => {
  const buf = await sharp(frame(11))
    .withExif({ IFD2: { DateTimeOriginal: '2026:05:21 11:12:21' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '13/1 0/1 36/1', GPSLongitudeRef: 'E', GPSLongitude: '126/1 30/1 36/1' } })
    .jpeg()
    .toBuffer();
  const ex = await R.readExif(buf);
  assert.equal(ex.taken, '2026-05-21T11:12');
  assert.ok(Math.abs(ex.gps.lat - 13.01) < 0.001);
  const none = await R.readExif(frame(11));
  assert.equal(none.taken, null);
  assert.equal(none.gps, null);
});

test('location inside the site boundary, far from it, or absent', () => {
  const site = { lat: 13.01, lon: 126.51, radiusM: 300 }; // synthetic (open sea)
  assert.equal(R.locationCheck({ exif: { gps: { lat: 13.0103, lon: 126.5102 } } }, site).level, 'ok');
  const far = R.locationCheck({ exif: { gps: { lat: 14.0, lon: 128.0 } } }, site);
  assert.equal(far.level, 'flag');
  assert.match(far.detail, /A mismatch, not proof/);
  assert.equal(R.locationCheck({ exif: { gps: null } }, site).level, 'info');
});

test("two months' views: comparable, compare with caution, or not comparable", async () => {
  const a = photo('a', await f(8), { period: '2026-02', sourceResolution: '1920x1080' });
  const b = photo('b', await f(9), { period: '2026-03', sourceResolution: '1920x1080' });
  assert.equal(R.comparabilityCheck(b, a).comparable, 'yes');

  const jan = photo('j', await f(7), { period: '2026-01', sourceResolution: '704x576' });
  const c = R.comparabilityCheck(photo('feb', await f(8), { sourceResolution: '1920x1080' }), jan);
  assert.equal(c.comparable, 'caution');
  assert.match(c.detail, /source resolution changed/);
  assert.match(c.detail, /"No visible change" does not mean "no work done"/);

  const flipped = photo('x', await features(await sharp(frame(9)).flop().toBuffer()), { sourceResolution: '1920x1080' });
  assert.equal(R.comparabilityCheck(flipped, a).comparable, 'no');
});
