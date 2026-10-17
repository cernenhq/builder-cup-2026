// Deterministic demo readers, used in tests and whenever GEMINI_API_KEY is absent.
// Their output is labelled "Demo, not a model result" everywhere it is shown.
// For the seeded demo lines they replay the two labels recorded in the prototype's evaluation,
// so the demo shows realistic agreement and disagreement. For any other line the answer comes
// from a hash of the line and the photo, which is stable but means nothing.
const crypto = require('crypto');

const MAP = { S: 'supported', C: 'contradicted', N: 'not_assessable' };
// Rough evidence regions on the demo camera view, [ymin, xmin, ymax, xmax] in 0-1000.
const REGIONS = {
  gc: [330, 80, 720, 420],
  gr: [300, 560, 700, 930],
  rs: [180, 250, 360, 800],
  re: [170, 250, 380, 820],
  rm: [190, 300, 370, 760],
  tc: [40, 20, 700, 300],
  mc: [420, 120, 820, 420],
  ca: [600, 280, 820, 640],
  wp: [160, 260, 330, 800],
  ho: [760, 0, 960, 1000]
};

function hashPick(s, n) {
  return crypto.createHash('sha256').update(s).digest()[0] % n;
}

function createMockReaders() {
  async function read(reader, input) {
    const findings = input.claims.map((c) => {
      const rec = c.recorded;
      let verdict;
      let reason;
      if (c.hidden) {
        verdict = 'not_assessable';
        reason = 'Hidden work; not visible in photos.';
      } else if (rec && rec[reader]) {
        verdict = MAP[rec[reader]];
        reason = (reader === 'A' ? rec.noteA : rec.noteB) || (verdict === 'not_assessable' ? 'Not visible enough in this photo to answer.' : verdict === 'supported' ? 'The photo shows what the line describes.' : 'The photo does not show what the line describes.');
      } else {
        const k = hashPick(`${reader}|${c.id}|${c.question}`, 10);
        verdict = k < 6 ? 'supported' : k < 8 ? 'not_assessable' : 'contradicted';
        reason = 'Demo reader answer from a fixed rule, not a reading of the photo.';
      }
      // Boxes only where the demo knows a rough region; otherwise no box rather than a made-up one.
      const box = verdict !== 'not_assessable' && input.photos.length ? REGIONS[c.lineKey] || null : null;
      return {
        claim_id: c.id,
        question: c.question,
        verdict,
        confidence: verdict === 'not_assessable' ? 'medium' : rec ? 'high' : 'low',
        reason,
        box_2d: box,
        photo_index: 0
      };
    });
    return { mode: 'mock', model: 'demo-reader', ok: true, findings, ms: 0 };
  }
  return { mode: 'mock', read, async resolveModel() { return 'demo-reader'; } };
}

module.exports = { createMockReaders };
