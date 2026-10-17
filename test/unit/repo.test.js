// Repo-wide text rules: no accusatory words in anything user-facing, no em dashes anywhere we wrote,
// product and brand names only from src/brand.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { findBanned } = require('../../src/domain/wording');
const { PRODUCT_NAME, BRAND, BRAND_DISPLAY } = require('../../src/brand');

const EM = String.fromCharCode(0x2014);
const REG = String.fromCharCode(0xae);
const TM = String.fromCharCode(0x2122);
const ROOT = path.join(__dirname, '..', '..');
const SKIP = new Set(['node_modules', '.git', 'seed-photos', 'docs', 'test-results', 'playwright-report', 'data']);
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|html|css|md|json|sh|yaml|yml|txt)$|Dockerfile$/.test(e.name) && e.name !== 'package-lock.json') out.push(p);
  }
  return out;
}
const files = walk(ROOT);

test('no em dash in any file we wrote', () => {
  const bad = files.filter((f) => fs.readFileSync(f, 'utf8').includes(EM));
  assert.deepEqual(bad.map((f) => path.relative(ROOT, f)), []);
});

test('no accusatory words in UI, API, reports, seed data or README', () => {
  const userFacing = files.filter((f) => !f.endsWith(path.join('domain', 'wording.js')) && !f.includes(`${path.sep}test${path.sep}`));
  const hits = [];
  for (const f of userFacing) {
    const words = findBanned(fs.readFileSync(f, 'utf8'));
    if (words.length) hits.push(`${path.relative(ROOT, f)}: ${words.join(', ')}`);
  }
  assert.deepEqual(hits, []);
});

test('product and brand names live in one constant; brand shows with the trademark sign, never the registered sign', () => {
  assert.equal(PRODUCT_NAME, 'Proof of Progress');
  assert.equal(BRAND, 'Cernen');
  assert.equal(BRAND_DISPLAY, `Cernen${TM}`);
  const literal = files.filter((f) => !f.endsWith(path.join('src', 'brand.js')) && !f.endsWith('README.md') && !f.endsWith('package.json') && !f.includes(`${path.sep}test${path.sep}`) && fs.readFileSync(f, 'utf8').includes(PRODUCT_NAME));
  assert.deepEqual(literal.map((f) => path.relative(ROOT, f)), [], 'pages use {{PRODUCT_NAME}} placeholders');
  assert.ok(!files.some((f) => fs.readFileSync(f, 'utf8').includes(REG)), 'no registered sign anywhere');
});

test('user-facing copy says "progress claim", not bill or billed line', () => {
  const ui = files.filter((f) => f.includes(`${path.sep}public${path.sep}`) || f.endsWith('README.md') || f.includes(`${path.sep}domain${path.sep}`));
  const hits = ui.filter((f) => /\bbill(ed|ing|s)?\b/i.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(hits.map((f) => path.relative(ROOT, f)), []);
});
