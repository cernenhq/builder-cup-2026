// The secret scan in the test script must actually catch a planted key.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'scripts', 'secret-scan.sh');

test('secret scan passes on the repo and fails on a planted Google API key', () => {
  const clean = spawnSync('bash', [script, path.join(__dirname, '..', '..')], { encoding: 'utf8' });
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  const fakeKey = `AI${'za'}${'x'.repeat(35)}`;
  fs.writeFileSync(path.join(dir, 'leak.js'), `const GEMINI = '${fakeKey}';\n`);
  const dirty = spawnSync('bash', [script, dir], { encoding: 'utf8' });
  assert.equal(dirty.status, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
