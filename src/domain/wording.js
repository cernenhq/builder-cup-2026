// Wording rules, kept in one place so the UI, API messages and report drafts say the same thing.
// The tool flags; a person decides. Nothing here accuses anyone.

// Words that must never appear in user-facing text. Model output is passed through
// neutralize() so a model's phrasing cannot bring them in either.
// Stored as fragments so a plain text search of the repo only finds them in this file.
const BANNED = [
  ['fra', 'ud'],
  ['fa', 'ke'],
  ['pro', 'ven'],
  ['proof of wrong', 'doing'],
  ['fabri', 'cated'],
  ['forg', 'ed'],
  ['tamper', 'ed']
].map((p) => p.join(''));

// Em dash, written as a char code so the character itself never appears in the repo.
const EM_DASH_RE = new RegExp(String.fromCharCode(0x2014), 'g');
const BANNED_RE = new RegExp(`\\b(${BANNED.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\w*`, 'gi');

function findBanned(text) {
  const out = [];
  const s = String(text || '');
  let m;
  BANNED_RE.lastIndex = 0;
  while ((m = BANNED_RE.exec(s))) out.push(m[0]);
  return out;
}

function neutralize(text) {
  return String(text || '').replace(BANNED_RE, '[wording removed]').replace(EM_DASH_RE, ',');
}

const PHRASES = {
  metadataMismatch: 'A mismatch, not proof of where or when a photo was taken.',
  noVisibleChange: '"No visible change" does not mean "no work done".',
  reuseFlag: 'A reused photo is a flag for review.',
  hiddenWork: "Hidden work (for example waterproofing or interior work) is always \"can't tell\" from photos.",
  missingMetadata: 'Missing metadata is noted, not held against the submitter. GPS and dates are never required.',
  personDecides: 'The tool never approves, holds or releases a payment and never sends anything. A person decides every line.',
  draftNotSent: 'DRAFT for the office to check and submit. Nothing has been sent.',
  mockReader: 'Demo, not a model result',
  publicDisclaimer:
    'Photos cannot show every kind of work. Something not visible in a photo may still have been done, for example work inside the building or below ground.'
};

const VERDICT_LABEL = {
  supported: 'Supported',
  contradicted: 'Contradicted',
  not_assessable: "Can't tell",
  disagree: 'Readers disagree',
  no_answer: 'No answer'
};

module.exports = { BANNED, findBanned, neutralize, PHRASES, VERDICT_LABEL };
