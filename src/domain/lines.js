// Turning a progress-claim line into one question a photo can answer, and combining two readers.
const { PHRASES } = require('./wording');

// Parse a claimed percent from a statement like "Rooftop masonry partitions: 40%" or a status
// like "Tower crane demobilisation: done".
function pctFromStatement(s) {
  const m = String(s || '').match(/(\d{1,3})\s*%/);
  if (m) return Math.min(100, Number(m[1]));
  if (/not done|not yet|none/i.test(s)) return 0;
  if (/\b(done|in place|on site|complete)\b/i.test(s)) return 100;
  return null;
}

// One question per claim line. Percentages are never asked as such: a photo cannot measure 60%,
// so the question asks about the visible state the claim implies (none, partly, fully).
function questionFor(line, claimedPct) {
  if (line.hidden) return `${line.label}: hidden work, not visible in photos.`;
  const q = line.q || {};
  const pct = claimedPct == null ? null : Number(claimedPct);
  if (pct === null) return q.partial || `Work on "${line.label}" is visible.`;
  if (pct >= 100) return q.done || `"${line.label}" is visibly complete within the photo, with no unfinished parts showing.`;
  if (pct <= 0) return q.none || `No work on "${line.label}" is visible yet.`;
  return q.partial || `Work on "${line.label}" is visible but not finished.`;
}

function statementFor(line, claimedPct) {
  if (line.status) return `${line.label}: ${claimedPct >= 100 ? line.status.done : line.status.none}`;
  return `${line.label}: ${claimedPct}%`;
}

// Combine readers A and B into the AI default the reviewer starts from.
// Hidden work is always "can't tell", whatever a reader said.
function combine(line, a, b) {
  if (line.hidden) {
    return { aiDefault: 'not_assessable', agree: true, hiddenRule: true, note: PHRASES.hiddenWork };
  }
  const va = a && a.verdict;
  const vb = b && b.verdict;
  if (va && vb) {
    if (va === vb) return { aiDefault: va, agree: true };
    return { aiDefault: 'disagree', agree: false, note: 'The two readers disagree. A person decides without a default.' };
  }
  if (va || vb) return { aiDefault: va || vb, agree: null, note: 'Only one reader answered.' };
  return { aiDefault: 'no_answer', agree: null, note: 'Neither reader answered. A person decides from the photo.' };
}

module.exports = { pctFromStatement, questionFor, statementFor, combine };
