// The most recent model calls on this instance, kept in memory for the "under the hood" page.
// It keeps only the fields listed in pick(): no prompt text, no photo, no workspace id, no error text.
// Nothing is written to disk; a restart empties it.
const MAX = 20;
const ring = [];

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function pick(ev) {
  const e = ev || {};
  const u = e.usage || {};
  return {
    at: new Date().toISOString(),
    kind: typeof e.kind === 'string' ? e.kind.slice(0, 20) : null,
    reader: typeof e.reader === 'string' ? e.reader.slice(0, 4) : null,
    model: typeof e.model === 'string' ? e.model.slice(0, 60) : null,
    ms: num(e.ms),
    lines: num(e.lines),
    msPerLine: num(e.msPerLine),
    tokens: { prompt: num(u.promptTokenCount), output: num(u.candidatesTokenCount), thinking: num(u.thoughtsTokenCount) },
    usd: num(e.usd),
    error: !!e.error
  };
}

function push(ev) {
  try {
    ring.push(pick(ev));
    while (ring.length > MAX) ring.shift();
  } catch (e) {
    // Never let the log break a model call.
  }
}

// Newest first.
function recent() {
  return ring.slice().reverse();
}

function clear() {
  ring.length = 0;
}

module.exports = { push, recent, clear, MAX };
