// Records the saved Cloud Vision web-detection results the demo replays ("Has this site photo appeared
// online?"). Runs locally with Application Default Credentials; the Vision API must be enabled on the
// project. Costs money: about US$0.0035 per photo (our estimate), 12 photos, stopped by a daily cap.
//   GOOGLE_CLOUD_PROJECT=<id> node scripts/record-vision.js
// Merges the results into src/seed/saved-runs.json under 'visioncache'; aicache and notecache are kept as they are.
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const CAP = Number(process.env.DAILY_CAP_USD || 0.1);
const PHOTO_DIR = path.join(__dirname, '..', 'seed-photos');
const SAVED = path.join(__dirname, '..', 'src', 'seed', 'saved-runs.json');

async function main() {
  const photoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pop-vision-'));
  const { build } = require('../src/server');
  const built = await build({
    ...process.env,
    NODE_ENV: 'development',
    STORE: 'memory',
    PHOTOS: 'local',
    PHOTO_DIR: photoDir,
    MOCK_AI: '1', // no Gemini calls here
    WORKSPACES: '0',
    SEED: 'none',
    VISION: '1',
    RECORD_SHARED: '1',
    DAILY_CAP_USD: String(CAP)
  });
  const { config, rootStore, store } = built;
  const { createVision } = require('../src/ai/vision');
  const { createSpendGuard } = require('../src/ai/spend');
  const { manilaDate } = require('../src/clock');
  // The app builds no spend guard when Gemini is mocked, so the script makes its own under the same cap.
  const spend = createSpendGuard({ rootStore, capUsd: CAP, dayFn: () => manilaDate(new Date()) });
  const vision = createVision({ config, rootStore, store, spend });

  // The 11 seed photos plus the mirrored p08 the seed uses for P-003 May 2026 (same sharp call as src/seed/seed.js).
  const items = fs
    .readdirSync(PHOTO_DIR)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort()
    .map((f) => ({ name: f, buffer: fs.readFileSync(path.join(PHOTO_DIR, f)) }));
  const mirrored = await sharp(fs.readFileSync(path.join(PHOTO_DIR, 'p08.jpg'))).flop().jpeg({ quality: 88 }).toBuffer();
  items.push({ name: 'p08.jpg mirrored (P-003 annex_may.jpg)', buffer: mirrored });

  for (const it of items) {
    const f = await vision.check({ id: it.name, fileName: it.name }, it.buffer, { live: true });
    console.log(`${it.name}: ${f.level} | ${f.title}${f.detail ? ` | ${f.detail}` : ''}`);
  }

  const visioncache = await rootStore.find('visioncache', {});
  let saved = {};
  try {
    saved = JSON.parse(fs.readFileSync(SAVED, 'utf8'));
  } catch (e) {
    // Never overwrite a saved-runs file we could not read (it holds the saved Gemini answers).
    if (fs.existsSync(SAVED)) throw new Error(`Could not read ${SAVED}: ${e.message}. Nothing written.`);
    saved = { aicache: [], notecache: [] };
  }
  const byId = Object.fromEntries((saved.visioncache || []).map((d) => [d.id, d]));
  for (const d of visioncache) byId[d.id] = d;
  saved.visioncache = Object.values(byId);
  saved.visionRecordedAt = new Date().toISOString();
  fs.writeFileSync(SAVED, `${JSON.stringify(saved, null, 1)}\n`);
  console.log(`Saved ${saved.visioncache.length} web results to src/seed/saved-runs.json (already saved ones were replayed, not re-run).`);
  console.log(`Estimated spend: US$${(await spend.today()).toFixed(4)} (cap US$${CAP}).`);
  fs.rmSync(photoDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
