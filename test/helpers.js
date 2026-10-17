// Starts an isolated server for API tests. STORE=firestore (with FIRESTORE_EMULATOR_HOST) runs the
// same tests against the Firestore emulator; each test process gets its own collection prefix.
const os = require('os');
const fs = require('fs');
const path = require('path');

async function startServer(extraEnv = {}) {
  const photoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pop-photos-'));
  const store = process.env.STORE || 'memory';
  if (store === 'firestore') process.env.FIRESTORE_PREFIX = `t${process.pid}_${Date.now().toString(36)}_`;
  const env = {
    ...process.env,
    STORE: store,
    PHOTO_DIR: photoDir,
    PHOTOS: 'local',
    MOCK_AI: '1',
    SEED: 'reset',
    ALLOW_TEST_RESET: '1',
    GEMINI_API_KEY: '',
    ...extraEnv
  };
  const { build } = require('../src/server');
  const built = await build(env);
  const server = built.app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const H = { 'x-pop-request': '1' };

  async function login(userId) {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ userId }) });
    if (r.status !== 200) throw new Error(`login ${userId} -> ${r.status}`);
    return r.headers.get('set-cookie').split(';')[0];
  }
  async function call(method, p, { cookie, body, form, headers } = {}) {
    const h = { ...H, ...(headers || {}) };
    if (cookie) h.cookie = cookie;
    let b;
    if (form) b = form;
    else if (body !== undefined) {
      h['content-type'] = 'application/json';
      b = JSON.stringify(body);
    }
    const r = await fetch(base + p, { method, headers: h, body: b, redirect: 'manual' });
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = null;
    }
    return { status: r.status, json, text, headers: r.headers };
  }
  async function close() {
    await new Promise((r) => server.close(r));
    if (store === 'firestore') await built.store.clear();
    await built.store.close();
    fs.rmSync(photoDir, { recursive: true, force: true });
  }
  return { base, login, call, close, built };
}

const SEED_PHOTOS = path.join(__dirname, '..', 'seed-photos');
module.exports = { startServer, SEED_PHOTOS };
