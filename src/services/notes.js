// "Draft with Gemini": a plain-language note written from the decision log only (the lines a person
// has decided, with their reasons, and the office's percent complete). Nothing is sent: the person
// edits the draft and decides what to do with it. Saved drafts replay for visitors without the judge
// access code; a new draft needs the code and stays under the daily spend cap.
const crypto = require('crypto');
const { effectiveDecisions } = require('./snapshot');
const { periodId } = require('./check');
const { neutralize, VERDICT_LABEL } = require('../domain/wording');
const { monthLabel } = require('../domain/escalation');

const AUDIENCES = {
  office: 'the office head of the municipal engineering office (an internal note: what the photos support, what they contradict, what they cannot show, and what to follow up, such as a site visit)',
  mayor: 'the municipal mayor (three or four short sentences: only what needs the mayor\'s attention, in plain words)',
  public: 'residents near the project (a plain progress note: no verdict labels, no staff names, no judgement of anyone, only what the photos show and what they cannot show)'
};

function facts({ project, period, per, decided }) {
  const lines = decided.map((d) => `- ${d.lineLabel}: claimed ${d.claimedPct}% ; the person decided "${VERDICT_LABEL[d.decision] || d.decision}" (reason: ${String(d.reason).slice(0, 300)})`);
  const pct = per.percentComplete ? `${per.percentComplete.value}%` : 'not entered yet';
  return `Project: ${project.name} (fictional demo project).
Reporting period: ${monthLabel(period)}.
Percent complete entered by the office: ${pct}.
Decided lines (from the decision log):
${lines.join('\n')}`;
}

function promptFor(audience, f) {
  return `Write a short draft note for ${AUDIENCES[audience]}.
Use only the facts below. Do not add numbers, dates or names that are not in them.
Rules: describe what the photos show; never accuse anyone or guess at intent; "can't tell" means the camera cannot see it (hidden work such as waterproofing is never visible); "no visible change" does not mean "no work done"; the note decides nothing about payment.
Plain English, under 120 words, no headings, no em dashes. This is a draft a person will edit; it is not sent.

${f}`;
}

async function draftNote({ store, rootStore, live, spend, judge, config, project, period, audience, today }) { // eslint-disable-line no-unused-vars
  if (!AUDIENCES[audience]) throw Object.assign(new Error('Choose who the note is for: office, mayor or public.'), { status: 400 });
  const per = await store.get('periods', periodId(project.id, period));
  if (!per || !per.check) throw Object.assign(new Error('Run the check for this period first.'), { status: 400 });
  const eff = effectiveDecisions(await store.find('decisions', { projectId: project.id }), [per]);
  const decided = per.check.lines
    .map((l) => ({ l, d: eff.get(`${period}|${l.lineKey}`) }))
    .filter((x) => x.d)
    .map(({ l, d }) => ({ lineKey: l.lineKey, lineLabel: l.label, claimedPct: l.claimedPct, decision: d.decision, reason: d.reason }));
  if (!decided.length) throw Object.assign(new Error('Decide at least one line first: the note is written from decisions only.'), { status: 400 });
  const model = config.ai === 'mock' ? 'demo-reader' : config.geminiModel;
  const f = facts({ project, period, per, decided });
  const key = crypto.createHash('sha256').update(`${model}|${audience}|${f}`).digest('hex').slice(0, 40);
  // A visitor's own drafts first (kept in their copy), then the shared saved drafts for the seeded decisions.
  const own = await store.get('notecache', key);
  if (own) return { text: own.text, model: own.model, at: own.at, saved: true, audience, key };
  const hit = await rootStore.get('notecache', key);
  if (hit) return { text: hit.text, model: hit.model, at: hit.at, saved: true, audience, key };
  if (!live) throw Object.assign(new Error('Live AI is off in this deployment, and no saved draft matches these decisions.'), { status: 403, needsCode: false });
  if (!judge) throw Object.assign(new Error('Live Gemini actions need the judge access code (enter it on the sign-in page).'), { status: 403, needsCode: true });
  const prompt = promptFor(audience, f);
  const est = live.estimateWrite ? live.estimateWrite(prompt) : { ok: true, maxUsd: 0.02 };
  if (!est.ok) throw Object.assign(new Error(est.error), { status: 400 });
  const ticket = spend ? await spend.reserve('note', est.maxUsd) : { amount: 0 };
  if (!ticket) throw Object.assign(new Error("Today's live AI budget for the demo is used up. Saved runs still work; please try again tomorrow."), { status: 429 });
  let r;
  try {
    r = await live.write(prompt);
  } finally {
    if (spend) await spend.settle(ticket, r && r.usd);
  }
  if (!r.ok) throw Object.assign(new Error(`${r.error} Try again in a few seconds.`), { status: 502 });
  const text = neutralize(r.text);
  const at = new Date().toISOString();
  await (config.recordShared ? rootStore : store).set('notecache', key, { id: key, text, model: r.model, at, audience });
  return { text, model: r.model, at, saved: false, audience, key };
}

module.exports = { draftNote, promptFor, facts, AUDIENCES };
