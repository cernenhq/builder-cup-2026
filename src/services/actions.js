// Write operations. Each one records who did it and when. None of them sends anything anywhere,
// approves or holds a payment, or decides a line on a person's behalf.
const { photoKeyPrefix } = require('../workspace');
const crypto = require('crypto');
const { readExif } = require('../domain/rules');
const { features } = require('../domain/imagefeatures');
const { pctFromStatement, questionFor, statementFor } = require('../domain/lines');
const { dueDate, obligationStatus, KINDS, periodKeyFor } = require('../domain/deadlines');
const { VERDICTS } = require('../ai/schema');
const { getOrCreatePeriod, periodId } = require('./check');

class UserError extends Error {
  constructor(msg, status = 400) {
    super(msg);
    this.status = status;
  }
}

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function checkPeriod(p) {
  if (!PERIOD_RE.test(String(p))) throw new UserError('Period must look like 2026-05.');
}
function who(user) {
  return { uid: user.id, name: user.name, role: user.role };
}
let seq = 0;
const nextSeq = () => ++seq;

async function addPhoto({ store, photoStore, project, period, buffer, fileName, contentType, user, source, stampText, recorded, createdAt }) {
  checkPeriod(period);
  if (!buffer || !buffer.length) throw new UserError('Empty file.');
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(contentType || '')) throw new UserError('Upload a JPEG, PNG, WebP or HEIC photo.');
  await getOrCreatePeriod(store, project, period);
  let f;
  try {
    f = await features(buffer);
  } catch (e) {
    throw new UserError('That file could not be read as a photo.');
  }
  const exif = recorded && recorded.exif ? recorded.exif : await readExif(buffer);
  const id = `ph_${crypto.randomUUID().slice(0, 12)}`;
  const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const storageKey = `${photoKeyPrefix()}${project.id}/${period}/${id}.${ext}`;
  await photoStore.put(storageKey, buffer, contentType);
  const doc = {
    id,
    projectId: project.id,
    period,
    fileName: String(fileName || `${id}.${ext}`).slice(0, 120),
    contentType,
    storageKey,
    bytes: buffer.length,
    width: f.width,
    height: f.height,
    phash: f.phash,
    phashMirror: f.phashMirror,
    edges: f.edges,
    exif,
    metadataSource: recorded && recorded.exif ? recorded.metadataSource : 'read from the uploaded file',
    stampText: stampText ? String(stampText).slice(0, 60) : '',
    sourceResolution: (recorded && recorded.sourceResolution) || `${f.width}x${f.height}`,
    framingNote: (recorded && recorded.framingNote) || '',
    source,
    uploadedBy: user ? who(user) : { uid: null, name: 'Contractor (via project link)', role: 'contractor' },
    createdAt: createdAt || new Date().toISOString()
  };
  await store.set('photos', id, doc);
  return doc;
}

async function setStamp({ store, photo, stampText }) {
  await store.update('photos', photo.id, { stampText: String(stampText || '').slice(0, 60) });
}

// Claims arrive as [{lineKey, claimedPct}] from the contractor or are typed by the office.
function normaliseClaims(project, claims) {
  if (!Array.isArray(claims)) throw new UserError('Send claims as a list of line items.');
  const lines = Object.fromEntries((project.lines || []).map((l) => [l.key, l]));
  const out = [];
  for (const c of claims) {
    const line = lines[c.lineKey];
    if (!line) throw new UserError(`Unknown line item ${c.lineKey}.`);
    if (c.claimedPct === '' || c.claimedPct === null || c.claimedPct === undefined) continue;
    const pct = Number(c.claimedPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new UserError(`Percent for ${line.label} must be 0 to 100.`);
    out.push({ lineKey: line.key, claimedPct: Math.round(pct * 10) / 10, statement: c.statement || statementFor(line, pct), question: c.question || questionFor(line, pct), claimId: c.claimId || null });
  }
  return out;
}

async function setClaims({ store, project, period, claims, user, source, today }) {
  checkPeriod(period);
  const per = await getOrCreatePeriod(store, project, period);
  const norm = normaliseClaims(project, claims);
  await store.update('periods', per.id, { claims: norm, claimsSource: source, claimsUpdatedAt: new Date().toISOString(), claimsUpdatedBy: user ? who(user) : { name: 'Contractor', role: 'contractor' } });
  if (source === 'office' && user) {
    // Credit: the office entered the contractor's claim for them.
    const subs = await store.find('submissions', { projectId: project.id, period });
    if (!subs.some((s) => s.source === 'contractor')) {
      const existing = await store.find('monitoring', { projectId: project.id });
      if (!existing.some((m) => m.auto === `claims|${period}`)) {
        await logMonitoring({ store, project, user, entry: { date: today || new Date().toISOString().slice(0, 10), kind: 'Progress claim entered for the contractor', hours: 0.5, note: `The contractor sent nothing for ${period}; the office typed the claimed percentages.` }, auto: `claims|${period}` });
      }
    }
  }
  return norm;
}

async function setPercent({ store, project, period, value, user, narrative }) {
  checkPeriod(period);
  const v = Number(value);
  if (!Number.isFinite(v) || v < 0 || v > 100) throw new UserError('Percent complete must be a number from 0 to 100.');
  const per = await getOrCreatePeriod(store, project, period);
  const entry = { value: Math.round(v * 10) / 10, enteredBy: user.id, enteredByName: user.name, enteredAt: new Date().toISOString() };
  const patch = { percentComplete: entry, percentHistory: [...(per.percentHistory || []), entry] };
  if (typeof narrative === 'string') patch.narrativeOverride = narrative.slice(0, 3000);
  await store.update('periods', per.id, patch);
  return entry;
}

// The engineer in charge or the office head confirms or overrides one line. A reason is always required.
async function decideLine({ store, project, period, lineKey, decision, reason, user, at }) {
  checkPeriod(period);
  if (!VERDICTS.includes(decision)) throw new UserError('Decision must be supported, contradicted or not_assessable.');
  const r = String(reason || '').trim();
  if (r.length < 3) throw new UserError('Give a reason for every decision.');
  const per = await store.get('periods', periodId(project.id, period));
  if (!per || !per.check) throw new UserError('Run the check for this period first.');
  const line = per.check.lines.find((l) => l.lineKey === lineKey);
  if (!line) throw new UserError('That line is not in this period.');
  const overrode = line.aiDefault !== decision;
  const doc = {
    kind: 'line',
    projectId: project.id,
    period,
    lineKey,
    lineLabel: line.label,
    claimId: line.claimId,
    statement: line.statement,
    checkRunId: per.check.runId,
    aiMode: per.check.aiMode,
    readerA: line.readers.A ? line.readers.A.verdict : null,
    readerB: line.readers.B ? line.readers.B.verdict : null,
    aiDefault: line.aiDefault,
    decision,
    overrode,
    readersDisagreed: line.aiDefault === 'disagree',
    reason: r.slice(0, 1000),
    by: who(user),
    at: at || new Date().toISOString(),
    seq: nextSeq()
  };
  doc.id = `dec_${crypto.randomUUID().slice(0, 12)}`;
  await store.set('decisions', doc.id, doc);
  return doc;
}

// The reviewer can write down an explanation for a flagged photo check. Logged, never required.
async function explainFlag({ store, project, period, photoId, checkKey, explanation, user }) {
  const per = await store.get('periods', periodId(project.id, period));
  if (!per || !per.check) throw new UserError('Run the check for this period first.');
  const e = String(explanation || '').trim();
  if (e.length < 3) throw new UserError('Write a short explanation.');
  const note = { photoId, checkKey, explanation: e.slice(0, 500), by: who(user), at: new Date().toISOString() };
  await store.update('periods', per.id, { flagNotes: [...(per.flagNotes || []), note] });
  const id = `dec_${crypto.randomUUID().slice(0, 12)}`;
  await store.set('decisions', id, { id, kind: 'flag', projectId: project.id, period, photoId, checkKey, reason: note.explanation, by: note.by, at: note.at, seq: nextSeq() });
  return note;
}

// Log that a report was actually submitted. The server works out the due date and whether it was late.
async function logTransmittal({ store, photoStore, project, input, user, photo, today }) {
  const kind = String(input.reportKind || '');
  if (!KINDS[kind]) throw new UserError('Pick which report was submitted.');
  let periodKey = String(input.periodKey || '');
  if (PERIOD_RE.test(periodKey)) periodKey = periodKeyFor(kind, periodKey);
  if (!/^\d{4}(-(0[1-9]|1[0-2]|Q[1-4]))?$/.test(periodKey)) throw new UserError('Period must look like 2026-05, 2026-Q2 or 2026.');
  const submittedOn = String(input.submittedOn || '');
  if (!DATE_RE.test(submittedOn)) throw new UserError('Give the date it was submitted, like 2026-06-03.');
  if (today && submittedOn > today) throw new UserError('The submission date cannot be in the future.');
  const to = String(input.to || '').trim();
  if (to.length < 2) throw new UserError('Say who received it.');
  const due = dueDate(kind, periodKey);
  const st = obligationStatus(due, [{ submittedOn }], today || submittedOn);
  let photoId = null;
  if (photo) {
    const ph = await addPhoto({ store, photoStore, project, period: /^\d{4}-\d{2}$/.test(periodKey) ? periodKey : submittedOn.slice(0, 7), buffer: photo.buffer, fileName: photo.originalname, contentType: photo.mimetype, user, source: 'transmittal' });
    photoId = ph.id;
  }
  const id = `tr_${crypto.randomUUID().slice(0, 12)}`;
  const doc = {
    id,
    projectId: project.id,
    reportKind: kind,
    reportName: KINDS[kind].name,
    periodKey,
    due,
    submittedOn,
    to: to.slice(0, 200),
    via: String(input.via || '').slice(0, 200),
    refNo: String(input.refNo || '').slice(0, 80),
    photoId,
    late: st.status === 'late',
    daysLate: st.daysLate || 0,
    countsAsOnTime: st.countsAsOnTime,
    loggedBy: who(user),
    loggedAt: new Date().toISOString()
  };
  await store.set('transmittals', id, doc);
  return doc;
}

const MONITORING_KINDS = ['Site visit', 'Remote check', 'Photos taken by the office', 'Progress claim entered for the contractor', 'Milestone report written for the contractor', 'Other'];
async function logMonitoring({ store, project, user, entry, auto }) {
  const kind = MONITORING_KINDS.includes(entry.kind) ? entry.kind : null;
  if (!kind) throw new UserError('Pick what kind of monitoring work this was.');
  if (!DATE_RE.test(String(entry.date || ''))) throw new UserError('Give the date, like 2026-05-28.');
  const hours = entry.hours === '' || entry.hours == null ? null : Number(entry.hours);
  if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 24)) throw new UserError('Hours must be 0 to 24.');
  const id = `mon_${crypto.randomUUID().slice(0, 12)}`;
  const doc = { id, projectId: project.id, date: entry.date, kind, hours, note: String(entry.note || '').slice(0, 1000), by: who(user), onBehalfOfContractor: /contractor/i.test(kind), auto: auto || null, loggedAt: new Date().toISOString() };
  await store.set('monitoring', id, doc);
  return doc;
}

// A contractor's submission through the project link: claims, photos and a note.
async function contractorSubmit({ store, photoStore, project, period, claims, files, note, receivedAt }) {
  checkPeriod(period);
  const norm = normaliseClaims(project, claims || []);
  if (!norm.length && !(files || []).length) throw new UserError('Add at least one percent or one photo.');
  const photoIds = [];
  for (const f of files || []) {
    const ph = await addPhoto({ store, photoStore, project, period, buffer: f.buffer, fileName: f.originalname, contentType: f.mimetype, user: null, source: 'contractor', stampText: f.stampText, createdAt: f.createdAt });
    photoIds.push(ph.id);
  }
  if (norm.length) await setClaims({ store, project, period, claims: norm, user: null, source: 'contractor' });
  const id = `sub_${crypto.randomUUID().slice(0, 12)}`;
  const doc = { id, projectId: project.id, period, source: 'contractor', receivedAt: receivedAt || new Date().toISOString(), claims: norm.map((c) => ({ lineKey: c.lineKey, claimedPct: c.claimedPct })), photoIds, note: String(note || '').slice(0, 2000) };
  await store.set('submissions', id, doc);
  return doc;
}

module.exports = {
  UserError,
  addPhoto,
  setStamp,
  setClaims,
  setPercent,
  decideLine,
  explainFlag,
  logTransmittal,
  logMonitoring,
  contractorSubmit,
  normaliseClaims,
  MONITORING_KINDS,
  pctFromStatement
};
