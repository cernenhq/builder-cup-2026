// Two public pages that need no sign-in:
// - /evidence: what the evaluation measured, read at startup from the result files in eval/.
// - /hood: how a check runs, plus the most recent model calls on this instance (src/ai/calllog.js)
//   and today's spend ledger as estimated by the app.
const fs = require('fs');
const path = require('path');
const calllog = require('../ai/calllog');

const EVAL_DIR = path.join(__dirname, '..', '..', 'eval');
const R2_FILE = 'R2_2026-10-17T2215.json';
const STRESS_FILE = 'reuse_stress_2026-10-18.json';
const EVAL_URL = 'https://github.com/cernenhq/builder-cup-2026/tree/main/eval';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(EVAL_DIR, file), 'utf8'));
  } catch (e) {
    return null;
  }
}

// Only the numbers the page shows; the per-line rows stay in the files.
function loadEvidence() {
  const r2 = readJson(R2_FILE);
  const st = readJson(STRESS_FILE);
  const m = (r2 && r2.metrics) || null;
  return {
    agreement: m
      ? {
          file: R2_FILE,
          recordedAt: r2.recordedAt || null,
          model: r2.model || null,
          referenceLines: m.referenceLines,
          referenceContradicted: m.referenceContradicted,
          acceptEveryLine: m.acceptEveryLine,
          geminiDefault: m.geminiDefault,
          readerA: m.readerA,
          readerB: m.readerB,
          timing: r2.timing || m.timing || null
        }
      : null,
    stress: st
      ? {
          file: STRESS_FILE,
          ranAt: st.ranAt || null,
          editedCopies: st.editedCopies ? { caught: st.editedCopies.caught, of: st.editedCopies.of, edits: st.editedCopies.edits || [] } : null,
          differentMonthsNotMatched: st.differentMonthsNotMatched ? { count: st.differentMonthsNotMatched.count, of: st.differentMonthsNotMatched.of } : null,
          cropsCaught: st.cropsCaught || null
        }
      : null,
    latency: { text: 'one live run, 8.4 s for two lines', date: '2026-10-18' },
    caveats:
      'Reference: lines where two AI labellers (Claude and GPT, labelled blind) agree; a provisional reference, not ground truth. One run. Reader A alone scored higher than the two-reader default; the second reader\'s value is flagging disagreement for the person.',
    filesUrl: EVAL_URL
  };
}

module.exports = function registerInsightRoutes(app, { wrap, spend, sendPage }) {
  const evidence = loadEvidence();

  app.get('/api/evidence', (req, res) => res.json(evidence));

  app.get(
    '/api/hood',
    wrap(async (req, res) => {
      let ledger = null;
      if (spend && typeof spend.state === 'function') {
        try {
          const s = await spend.state();
          ledger = { day: s.day, spentUsd: s.spent, reservedUsd: s.reserved, calls: s.calls, capUsd: s.capUsd, note: 'Estimated by the app, not the cloud account total.' };
        } catch (e) {
          ledger = null;
        }
      }
      res.json({ calls: calllog.recent(), spend: ledger });
    })
  );

  app.get('/evidence', (req, res) => sendPage(req, res, 'evidence.html'));
  app.get('/hood', (req, res) => sendPage(req, res, 'hood.html'));
};

module.exports.loadEvidence = loadEvidence;
