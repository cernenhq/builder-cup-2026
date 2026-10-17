// Entry point. Builds the adapters from environment variables, seeds the fictional demo data when
// SEED=demo and the seeded copy is missing or out of date, and starts listening on PORT (Cloud Run sets it).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadConfig } = require('./config');
const { createRootStore, createScopedStore } = require('./store');
const { createPhotos } = require('./photos');
const { createReaders, createSeedReaders } = require('./ai');
const { makeClock, manilaDate } = require('./clock');
const { createApp } = require('./app');
const { seedDemo } = require('./seed/seed');
const { DEMO_TODAY } = require('./seed/demo-data');
const { PRODUCT_NAME, BRAND } = require('./brand');
const { runInWs, TEMPLATE, MAIN } = require('./workspace');

const SAVED_RUNS = path.join(__dirname, 'seed', 'saved-runs.json');

function loadSavedRuns() {
  try {
    return JSON.parse(fs.readFileSync(SAVED_RUNS, 'utf8'));
  } catch (e) {
    return { aicache: [], notecache: [] };
  }
}

// Changes whenever the demo data or the saved runs change, so a new deploy reseeds the template once.
function seedVersion() {
  const h = crypto.createHash('sha256');
  for (const f of ['seed/demo-data.js', 'seed/seed.js', 'seed/saved-runs.json']) {
    try {
      h.update(fs.readFileSync(path.join(__dirname, f)));
    } catch (e) {
      h.update('missing');
    }
  }
  return h.digest('hex').slice(0, 16);
}

async function build(env = process.env) {
  const config = loadConfig(env);
  const rootStore = createRootStore(config);
  const seedWs = config.workspaces ? TEMPLATE : MAIN;
  const store = createScopedStore(rootStore, seedWs);
  const photoStore = createPhotos(config);
  const dayFn = () => manilaDate(new Date());
  const { readers, live, spend } = createReaders(config, { rootStore, store, dayFn });
  // With demo data and no POP_TODAY, the clock is fixed to the demo date so the fictional
  // progress claims line up with their photos. With SEED=none the real date is used.
  const clock = makeClock(config.today || (['demo', 'reset'].includes(config.seed) ? DEMO_TODAY : ''));

  // Saved Gemini answers and drafts (recorded once with scripts/record-runs.js) go into the shared store.
  const saved = loadSavedRuns();
  for (const name of ['aicache', 'notecache']) {
    for (const d of saved[name] || []) if (!(await rootStore.get(name, d.id))) await rootStore.set(name, d.id, d);
  }
  const seedReaders = createSeedReaders({ rootStore, model: config.ai === 'mock' ? null : config.geminiModel });
  const version = seedVersion();
  const reseed = async () => runInWs(seedWs, async () => {
    await seedDemo({ store, photoStore, readers: seedReaders });
    await store.update('meta', 'seed', { version });
  });
  if (config.seed === 'demo' || config.seed === 'reset') {
    const meta = await runInWs(seedWs, () => store.get('meta', 'seed'));
    if (!meta || meta.version !== version || config.seed === 'reset') await reseed();
  }
  const app = createApp({ config, store, rootStore, photoStore, readers, live, spend, clock, reseed });
  return { app, config, store, rootStore, photoStore, readers, live, spend, clock };
}

if (require.main === module) {
  build()
    .then(({ app, config, store, photoStore, readers, clock }) => {
      app.listen(config.port, () => {
        console.log(`${PRODUCT_NAME} (${BRAND}) listening on :${config.port}`);
        console.log(`store=${store.kind} photos=${photoStore.kind} ai=${config.ai} model=${config.ai === 'mock' ? 'demo-reader' : config.geminiModel} workspaces=${config.workspaces} today=${clock.today()}${clock.fixed ? ' (fixed demo date)' : ''}`);
        if (readers.mode === 'mock') console.log('Live AI off: using the demo readers. Their output is labelled "Demo, not a model result".');
        if (config.ai !== 'mock' && !config.judgeCode) console.log('JUDGE_CODE not set: live model calls are off; saved runs still replay.');
        if (config.sessionSecretGenerated) console.log('SESSION_SECRET not set: using a random one; sessions end on restart.');
      });
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}

module.exports = { build };
