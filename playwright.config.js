// End-to-end tests: one real server, demo data reset before every test, Chromium.
// STORE=firestore with FIRESTORE_EMULATOR_HOST runs the same tests against the Firestore emulator.
const { defineConfig } = require('@playwright/test');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.E2E_PORT || 8091);
module.exports = defineConfig({
  testDir: 'test/e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1280, height: 900 } },
  webServer: {
    command: 'node src/server.js',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      ...process.env,
      PORT: String(PORT),
      STORE: process.env.STORE || 'memory',
      PHOTOS: 'local',
      PHOTO_DIR: path.join(os.tmpdir(), `pop-e2e-${PORT}`),
      MOCK_AI: '1',
      GEMINI_API_KEY: '',
      SEED: 'reset',
      ALLOW_TEST_RESET: '1',
      FIRESTORE_PREFIX: process.env.STORE === 'firestore' ? 'e2e_' : ''
    }
  }
});
