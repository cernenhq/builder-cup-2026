const { test: base, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const SEED_PHOTOS = path.join(__dirname, '..', '..', 'seed-photos');
// E2E_PREFIX=/builderscup runs every test through a path prefix (the cernen.com set-up; see
// playwright.config.js). Absolute app paths in goto and request calls get the prefix; screenshots are
// not written, so docs/screens keeps the root run's images.
const PREFIX = process.env.E2E_PREFIX || '';
const SCREENS = path.join(__dirname, '..', '..', 'docs', 'screens');
const H = { 'x-pop-request': '1' };
const withPrefix = (u) => (PREFIX && typeof u === 'string' && u.startsWith('/') && !u.startsWith('//') && u !== PREFIX && !u.startsWith(`${PREFIX}/`) ? PREFIX + u : u);
function prefixRequests(rc) {
  if (!PREFIX || rc.__prefixed) return rc;
  for (const m of ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch']) {
    const orig = rc[m].bind(rc);
    rc[m] = (u, ...rest) => orig(withPrefix(u), ...rest);
  }
  rc.__prefixed = true;
  return rc;
}

// Reset the demo data before every test so each job starts from the same state.
const test = base.extend({
  request: async ({ request }, use) => use(prefixRequests(request)),
  page: async ({ page, request }, use) => {
    if (PREFIX) {
      const goto = page.goto.bind(page);
      page.goto = (u, ...rest) => goto(withPrefix(u), ...rest);
      prefixRequests(page.request);
    }
    const r = await request.post('/api/test/reset', { headers: H });
    expect(r.status()).toBe(200);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Under a prefix, every request the page makes to this host must stay under it.
    const stray = [];
    if (PREFIX)
      page.on('request', (q) => {
        const u = new URL(q.url());
        if (/^https?:$/.test(u.protocol) && u.pathname !== PREFIX && !u.pathname.startsWith(`${PREFIX}/`)) stray.push(`${q.method()} ${u.pathname}`);
      });
    await use(page);
    expect(errors, 'no script errors on the page').toEqual([]);
    expect(stray, 'no requests outside the path prefix').toEqual([]);
  }
});

async function signIn(page, userId, role) {
  await page.goto('/');
  await page.click(`[data-user="${userId}"]`);
  await page.waitForURL(`**/${role}`);
}

// A copy of a public frame with EXIF date and GPS written in, to show the metadata is kept.
async function geotaggedFrame(n) {
  const out = path.join(os.tmpdir(), `pop-geotagged-p${n}.jpg`);
  const buf = await sharp(path.join(SEED_PHOTOS, `p${n}.jpg`))
    .withExif({ IFD2: { DateTimeOriginal: '2026:05:21 11:12:21' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '13/1 0/1 36/1', GPSLongitudeRef: 'E', GPSLongitude: '126/1 30/1 36/1' } })
    .jpeg({ quality: 90 })
    .toBuffer();
  fs.writeFileSync(out, buf);
  return out;
}

async function shot(page, name) {
  if (PREFIX) return;
  fs.mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: path.join(SCREENS, `${name}.png`), fullPage: true });
}

const VERDICT_TEXT = /Supported|Contradicted|Can't tell|Readers disagree|not_assessable/;

module.exports = { test, expect, signIn, geotaggedFrame, shot, SEED_PHOTOS, H, VERDICT_TEXT };
