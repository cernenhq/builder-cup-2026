// Builds the readers the app uses.
// - mock: deterministic demo readers, labelled "Demo, not a model result" (tests, local runs).
// - vertex / apikey: Gemini behind the saved-answer cache, the judge access code and the daily cap.
const { createGeminiReaders } = require('./gemini');
const { createMockReaders } = require('./mock');
const { createCachedReaders } = require('./cached');
const { createSpendGuard } = require('./spend');
const { als } = require('../workspace');

function createReaders(config, { rootStore, store, dayFn }) {
  if (config.ai === 'mock') return { readers: createMockReaders(), live: null, spend: null };
  const live = createGeminiReaders({
    apiKey: config.ai === 'apikey' ? config.geminiApiKey : undefined,
    vertex: config.ai === 'vertex' ? { project: config.gcpProject, location: config.gcpLocation } : undefined,
    model: config.geminiModel,
    modelB: config.geminiModelB
  });
  const spend = createSpendGuard({ rootStore, capUsd: config.dailyCapUsd, dayFn });
  const canSpend = async () => {
    const s = als.getStore();
    return !!(s && s.judge);
  };
  return { readers: createCachedReaders({ live, rootStore, store, spend, canSpend, shareLive: config.recordShared }), live, spend };
}

// Seeding replays saved Gemini answers where they exist and falls back to the demo readers, so a
// fresh start never calls a live model.
function createSeedReaders({ rootStore, model }) {
  const { inputKey } = require('./cached');
  const mock = createMockReaders();
  return {
    mode: 'mock',
    async read(reader, input) {
      const hit = model ? await rootStore.get('aicache', inputKey(model, reader, input)) : null;
      if (hit) return { ...hit.result, mode: 'saved', savedAt: hit.at };
      return mock.read(reader, input);
    },
    async resolveModel() {
      return model || 'demo-reader';
    }
  };
}

module.exports = { createReaders, createMockReaders, createSeedReaders };
