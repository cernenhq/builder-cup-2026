// End-to-end tests: one real server, demo data reset before every test, Chromium.
// STORE=firestore with FIRESTORE_EMULATOR_HOST runs the same tests against the Firestore emulator.
const { defineConfig } = require('@playwright/test');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.E2E_PORT || 8091);
const serverEnv = {
  ...process.env,
  STORE: process.env.STORE || 'memory',
  PHOTOS: 'local',
  PHOTO_DIR: path.join(os.tmpdir(), `pop-e2e-${PORT}`),
  MOCK_AI: '1',
  GEMINI_API_KEY: '',
  SEED: 'reset',
  ALLOW_TEST_RESET: '1',
  FIRESTORE_PREFIX: process.env.STORE === 'firestore' ? 'e2e_' : ''
};
// E2E_PREFIX=/builderscup E2E_FRONTDOOR=<cernen-site>/tools/local-frontdoor.js runs the same tests the
// way cernen.com serves the app: browser → cernen.com stand-in → /builderscup proxy → this app with
// BASE_PATH. The app listens on PORT+1; the stand-in on PORT.
const PREFIX = process.env.E2E_PREFIX || '';
const webServer = PREFIX
  ? [
      { command: 'node src/server.js', url: `http://127.0.0.1:${PORT + 1}/healthz`, reuseExistingServer: false, timeout: 60000, env: { ...serverEnv, PORT: String(PORT + 1), BASE_PATH: PREFIX, PROXY_SECRET: 'e2e-proxy-secret' } },
      {
        command: `node ${JSON.stringify(process.env.E2E_FRONTDOOR || '')} --port ${PORT} --upstream http://127.0.0.1:${PORT + 1}`,
        url: `http://127.0.0.1:${PORT}${PREFIX}/healthz`,
        reuseExistingServer: false,
        timeout: 60000,
        env: { ...process.env, PROXY_SECRET: 'e2e-proxy-secret' }
      }
    ]
  : {
      command: 'node src/server.js',
      url: `http://127.0.0.1:${PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 60000,
      env: { ...serverEnv, PORT: String(PORT) }
    };
module.exports = defineConfig({
  testDir: 'test/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  // In prefix mode the proxy reports https, so the app sets Secure cookies; Playwright's request helper
  // sends those over plain http only to localhost.
  use: { baseURL: `http://${PREFIX ? 'localhost' : '127.0.0.1'}:${PORT}`, viewport: { width: 1280, height: 900 } },
  webServer
});
