// Everything the Monday view, the mayor's gauge, the reports and the audit log need about one
// project, computed from stored records. Nothing here writes.
const { obligationsFor, obligationStatus, addDays, periodKeyFor } = require('../domain/deadlines');
const { latestPercent, slippage, overdueMilestones, plannedAt } = require('../domain/progress');
const { escalations } = require('../domain/escalation');

function effectiveDecisions(decisions, periods) {
  // Latest decision per period and line wins. Earlier ones stay in the log.
  // With periods given, only decisions made on the period's CURRENT check run count: a new run (new photos,
  // new claims) is unreviewed until a person decides again, so old decisions never vouch for new content.
  const runOf = periods ? new Map(periods.filter((p) => p.check).map((p) => [p.period, p.check.runId])) : null;
  const sorted = [...decisions]
    .filter((d) => d.kind === 'line' && (!runOf || !runOf.has(d.period) || d.checkRunId === runOf.get(d.period)))
    .sort((a, b) => (a.at === b.at ? (a.seq || 0) - (b.seq || 0) : a.at.localeCompare(b.at)));
  const map = new Map();
  for (const d of sorted) map.set(`${d.period}|${d.lineKey}`, d);
  return map;
}

async function loadProjectData(store, projectId) {
  const [project, periods, transmittals, decisions, submissions, monitoring] = await Promise.all([
    store.get('projects', projectId),
    store.find('periods', { projectId }),
    store.find('transmittals', { projectId }),
    store.find('decisions', { projectId }),
    store.find('submissions', { projectId }),
    store.find('monitoring', { projectId })
  ]);
  return { project, periods, transmittals, decisions, submissions, monitoring };
}

function obligationsWithStatus(project, transmittals, today) {
  const recentFrom = addDays(today, -45);
  return obligationsFor(project, today).map((o) => {
    const ts = transmittals.filter((t) => t.reportKind === o.kind && t.periodKey === o.periodKey);
    return { ...o, ...obligationStatus(o.due, ts, today), recent: o.due >= recentFrom, transmittalIds: ts.map((t) => t.id) };
  });
}

async function projectSnapshot(store, projectId, today, cfg, usersById) {
  const data = await loadProjectData(store, projectId);
  const { project, periods, transmittals, decisions, submissions } = data;
  if (!project) return null;
  const eff = effectiveDecisions(decisions, periods);
  const latest = latestPercent(periods);
  const slip = slippage(project, latest, today);
  const msOver = overdueMilestones(project, latest, today);
  const obligations = obligationsWithStatus(project, transmittals, today);

  let pendingReview = 0;
  let openPhotoFlags = 0;
  const checked = periods.filter((p) => p.check).sort((a, b) => a.period.localeCompare(b.period));
  for (const p of checked) {
    for (const l of p.check.lines) if (!eff.has(`${p.period}|${l.lineKey}`)) pendingReview++;
  }
  const lastChecked = checked[checked.length - 1];
  if (lastChecked) {
    const explained = new Set((lastChecked.flagNotes || []).map((n) => `${n.photoId}|${n.checkKey}`));
    for (const pc of lastChecked.check.photoChecks || []) for (const f of pc.findings) if (f.level === 'flag' && !explained.has(`${pc.photoId}|${f.key}`)) openPhotoFlags++;
  }

  // Most recent period with any confirmed decision: how many lines did the reviewer confirm as contradicted?
  let confirmedContradicted = null;
  const lineLabel = (k) => ((project.lines || []).find((l) => l.key === k) || {}).label || k;
  for (const p of [...checked].reverse()) {
    const ds = p.check.lines.map((l) => eff.get(`${p.period}|${l.lineKey}`)).filter(Boolean);
    if (!ds.length) continue;
    const con = ds.filter((d) => d.decision === 'contradicted');
    confirmedContradicted = { period: p.period, count: con.length, lines: con.map((d) => lineLabel(d.lineKey)) };
    break;
  }

  const lastClosed = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const hasContractor = submissions.some((s) => s.period === lastClosed && s.source === 'contractor');
  const missingContractorReport = lastClosed >= project.firstPeriod && !hasContractor ? lastClosed : null;

  const inCharge = usersById[project.inChargeId];
  const snap = {
    project,
    data,
    inChargeName: inCharge ? inCharge.name : 'Unassigned',
    latest,
    plannedToday: plannedAt(project, today),
    slippage: slip,
    overdueMilestones: msOver,
    obligations,
    pendingReview,
    openPhotoFlags,
    confirmedContradicted,
    missingContractorReport,
    effective: eff
  };
  snap.items = escalations(snap, cfg);
  snap.level = snap.items.reduce((m, i) => Math.max(m, i.level), 0);
  return snap;
}

async function usersMap(store) {
  const users = await store.find('users', {});
  return Object.fromEntries(users.map((u) => [u.id, u]));
}

async function allSnapshots(store, today, cfg) {
  const users = await usersMap(store);
  const projects = await store.find('projects', {});
  const snaps = [];
  for (const p of projects.sort((a, b) => a.id.localeCompare(b.id))) snaps.push(await projectSnapshot(store, p.id, today, cfg, users));
  return { snaps, users };
}

module.exports = { projectSnapshot, allSnapshots, usersMap, effectiveDecisions, loadProjectData, obligationsWithStatus, periodKeyFor };
