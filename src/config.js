// All settings come from environment variables. Nothing secret is stored in the repo.
const crypto = require('crypto');

function bool(v, d) {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}
function num(v, d) {
  const n = Number(v);
  return v === undefined || v === '' || Number.isNaN(n) ? d : n;
}

// '' or a single path segment such as '/builderscup' (no trailing slash).
function basePath(v) {
  const s = String(v || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^\/[a-z0-9][a-z0-9-]*$/i.test(s)) throw new Error(`BASE_PATH must look like /builderscup, got "${v}"`);
  return s;
}

function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  let sessionSecret = env.SESSION_SECRET || '';
  let sessionSecretGenerated = false;
  if (!sessionSecret) {
    // A random secret per process: sessions end when the instance restarts. Fine for local
    // demo use; on Cloud Run mount SESSION_SECRET from Secret Manager instead.
    sessionSecret = crypto.randomBytes(32).toString('hex');
    sessionSecretGenerated = true;
  }
  return {
    port: num(env.PORT, 8080),
    production,
    // memory | firestore
    store: env.STORE || (env.FIRESTORE_EMULATOR_HOST ? 'firestore' : 'memory'),
    // On Cloud Run leave both unset and the client finds the project from the service's identity.
    firestoreProjectId: env.FIRESTORE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || (env.FIRESTORE_EMULATOR_HOST ? 'demo-proof-of-progress' : undefined),
    firestoreDatabaseId: env.FIRESTORE_DATABASE_ID || '(default)',
    // local | gcs
    photos: env.PHOTOS || (env.PHOTO_BUCKET ? 'gcs' : 'local'),
    photoBucket: env.PHOTO_BUCKET || '',
    photoDir: env.PHOTO_DIR || 'data/photos',
    // Live AI: 'vertex' (Cloud Run: Vertex AI with the service account, no key), 'apikey' (local, GEMINI_API_KEY),
    // or 'mock' (deterministic demo readers). Default: vertex when LIVE_AI=1 and a project is known.
    ai: env.MOCK_AI && bool(env.MOCK_AI, false) ? 'mock' : bool(env.LIVE_AI, false) && (env.GOOGLE_CLOUD_PROJECT || env.FIRESTORE_PROJECT_ID) ? 'vertex' : env.GEMINI_API_KEY ? 'apikey' : 'mock',
    gcpProject: env.GOOGLE_CLOUD_PROJECT || env.FIRESTORE_PROJECT_ID || '',
    gcpLocation: env.GOOGLE_CLOUD_LOCATION || 'global',
    geminiApiKey: env.GEMINI_API_KEY || '',
    // Pinned so results are repeatable and the model named on screen is the one called.
    geminiModel: env.GEMINI_MODEL || 'gemini-3.8-flash',
    geminiModelB: env.GEMINI_MODEL_B || '',
    // Image model for the prototype's AI finished look (Vertex AI); empty turns that one feature off.
    imageModel: env.IMAGE_MODEL || '',
    // Live model calls need the judge access code (Secret Manager on Cloud Run) and stay under a daily cap.
    judgeCode: env.JUDGE_CODE || '',
    // OPEN_LIVE=1: live runs in the app's own flows (fixed prompts) need no code on this service, still
    // under the daily cap. The prototype's free-form Gemini endpoint keeps requiring the code.
    openLive: env.OPEN_LIVE === '1',
    dailyCapUsd: num(env.DAILY_CAP_USD, 3),
    // scripts/record-runs.js only: new answers and drafts become the shared saved seed runs.
    recordShared: bool(env.RECORD_SHARED, false),
    // Optional Google Cloud features, each off unless set (deploy.sh sets them):
    vision: bool(env.VISION, false), // Cloud Vision web detection: "has this photo appeared online?"
    translate: bool(env.TRANSLATE, false), // Cloud Translation: the public note in Filipino
    bqDataset: env.BQ_DATASET || '', // BigQuery: decision and check events for portfolio analytics
    bqTable: env.BQ_TABLE || 'events',
    // Per-visitor workspaces (on for the public demo; off for local runs and tests).
    workspaces: bool(env.WORKSPACES, false),
    workspaceHours: num(env.WORKSPACE_HOURS, 24),
    workspacesPerDay: num(env.WORKSPACES_PER_DAY, 400),
    // Force the deterministic demo readers even when a key is present (tests set this).
    forceMockAi: bool(env.MOCK_AI, false),
    sessionSecret,
    sessionSecretGenerated,
    sessionHours: num(env.SESSION_HOURS, 12),
    // Demo sign-in by picking a role. Turn off once real sign-in is wired (see README).
    demoLogin: bool(env.DEMO_LOGIN, true),
    // Fixed demo date so the fictional progress claims line up with their photos.
    // Unset POP_TODAY for real use and the real date is used.
    today: env.POP_TODAY || '',
    seed: env.SEED || 'demo',
    allowTestReset: bool(env.ALLOW_TEST_RESET, false),
    maxUploadMb: num(env.MAX_UPLOAD_MB, 15),
    // A second path the app is also served under, e.g. /builderscup when cernen.com/builderscup is
    // proxied here. The app keeps answering at / as well, so the service's own URL keeps working.
    basePath: basePath(env.BASE_PATH),
    // Shared with the cernen.com proxy. Only a request carrying it may name the visitor's address
    // (x-cernen-client-ip); everyone else is counted by the address Google's front end saw.
    proxySecret: env.PROXY_SECRET || '',
    escalation: {
      reportOverdueDays: num(env.ESCALATE_REPORT_OVERDUE_DAYS, 7),
      milestoneOverdueDays: num(env.ESCALATE_MILESTONE_OVERDUE_DAYS, 30),
      contradictedLines: num(env.ESCALATE_CONTRADICTED_LINES, 2),
      laggingPoints: num(env.LAGGING_POINTS, 5)
    }
  };
}

module.exports = { loadConfig };
