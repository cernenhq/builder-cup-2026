// Cloud Translation of the public note (optional, TRANSLATE=1).
// GET /api/public/projects/:id/note?lang=tl returns the public note with its human-readable text in
// Filipino (machine translation), labelled as such. Numbers, months and the project id stay as they are.
// No judge code is needed (public page, a few cents at most per day), but every call stays under the
// daily cap. When the cap or an error stops it, the answer is 503 and the English note stays available.
// deps.translator is a test hook; otherwise the server builds its own (see src/ai/translate.js for the
// TRANSLATE_STUB test client).
const { createTranslator } = require('../ai/translate');
const { createSpendGuard } = require('../ai/spend');
const { manilaDate } = require('../clock');

const LABEL = 'Machine translation (Google Cloud Translation). The English note is the official text.';
const HEADINGS = { photosShowHeading: 'What the photos show', notVisibleHeading: 'Not visible in the photos, or not yet confirmed', completeLabel: 'complete' };

module.exports = function registerTranslateRoutes(app, deps) {
  const { store, rootStore, wrap, config, publicFor } = deps;
  if (!config.translate) {
    app.get('/api/public/projects/:id/note', (req, res) => res.status(404).json({ error: 'Machine translation is not turned on for this site.' }));
    return;
  }
  // In demo-reader mode there is no model spend guard; translation still gets one on the same ledger.
  const spend = deps.spend || createSpendGuard({ rootStore, capUsd: config.dailyCapUsd, dayFn: () => manilaDate(new Date()) });
  const translator = deps.translator || createTranslator({ config, rootStore, store, spend });

  app.get('/api/public/projects/:id/note', wrap(async (req, res) => {
    const lang = req.query.lang || 'tl';
    if (lang !== 'tl') return res.status(400).json({ error: 'Only Filipino (lang=tl) is offered.' });
    const r = await publicFor(req.params.id);
    if (!r) return res.status(404).json({ error: 'No such project.' });
    const note = JSON.parse(JSON.stringify(r.note));
    const headings = { ...HEADINGS };

    // Collect the readable strings with a setter for each, translate them in one request, put them back.
    const slots = [];
    const add = (value, set) => {
      if (typeof value === 'string' && value.trim()) slots.push({ value, set });
    };
    for (const k of Object.keys(headings)) add(headings[k], (v) => (headings[k] = v));
    add(note.name, (v) => (note.name = v));
    add(note.location, (v) => (note.location = v));
    (note.photosShow || []).forEach((s) => add(s.text, (v) => (s.text = v)));
    (note.notVisible || []).forEach((s, i) => add(s, (v) => (note.notVisible[i] = v)));
    add(note.explainer, (v) => (note.explainer = v));

    let out;
    try {
      out = await translator.translate(slots.map((s) => s.value), 'tl');
    } catch (e) {
      const status = e.status === 413 || e.status === 400 ? e.status : 503;
      return res.status(status).json({ error: e.status ? e.message : 'Machine translation is not available right now. The English note is the official text.' });
    }
    slots.forEach((s, i) => s.set(out[i]));
    res.json({ lang: 'tl', label: LABEL, note, headings });
  }));
};
