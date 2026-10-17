// "Run the check" for one project period: rule checks first (no AI), then two readers, then the
// combined AI default per line. The result waits for the reviewer; nothing is decided here.
const { dateChecks, locationCheck, reuseCheck, comparabilityCheck } = require('../domain/rules');
const { questionFor, combine } = require('../domain/lines');
const { neutralize, PHRASES } = require('../domain/wording');
const { monthLabel } = require('../domain/escalation');

function periodId(projectId, period) {
  return `${projectId}__${period}`;
}

async function getOrCreatePeriod(store, project, period) {
  const id = periodId(project.id, period);
  let p = await store.get('periods', id);
  if (!p) {
    p = { id, projectId: project.id, period, claims: [], status: 'open', createdAt: new Date().toISOString() };
    await store.set('periods', id, p);
  }
  return p;
}

function cleanFinding(f) {
  if (!f) return null;
  return {
    verdict: f.verdict,
    confidence: f.confidence || null,
    question: neutralize(f.question || ''),
    reason: neutralize(f.reason || ''),
    box: Array.isArray(f.box_2d) && f.box_2d.length === 4 ? f.box_2d : null,
    photoIndex: Number.isInteger(f.photo_index) ? f.photo_index : 0
  };
}

async function runCheck({ store, photoStore, readers, project, period, user }) {
  const per = await getOrCreatePeriod(store, project, period);
  const photos = (await store.find('photos', { projectId: project.id, period })).filter((p) => p.source !== 'transmittal').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const allPhotos = (await store.find('photos', {})).filter((p) => p.source !== 'transmittal');
  const projects = await store.find('projects', {});
  const pname = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  // Earlier period with photos, for the comparability check.
  const earlier = allPhotos.filter((p) => p.projectId === project.id && p.period < period).sort((a, b) => b.period.localeCompare(a.period) || a.createdAt.localeCompare(b.createdAt));
  const prev = earlier.length ? earlier.filter((p) => p.period === earlier[0].period)[0] : null;

  const photoChecks = photos.map((ph, i) => {
    const others = allPhotos.filter((o) => o.id !== ph.id && o.createdAt < ph.createdAt).map((o) => ({ ...o, projectName: pname[o.projectId] }));
    const findings = [...dateChecks(ph, period), locationCheck(ph, project.site), reuseCheck(ph, others)];
    if (i === 0) findings.push(comparabilityCheck(ph, prev));
    return { photoId: ph.id, fileName: ph.fileName, findings };
  });

  const linesByKey = Object.fromEntries((project.lines || []).map((l) => [l.key, l]));
  const claims = (per.claims || []).filter((c) => linesByKey[c.lineKey]);
  const readerClaims = claims.map((c) => {
    const line = linesByKey[c.lineKey];
    const rec = (project.recordedLabels || {})[`${period}|${c.lineKey}`];
    return {
      id: c.claimId || c.lineKey,
      lineKey: c.lineKey,
      hidden: !!line.hidden,
      statement: c.statement,
      question: c.question || questionFor(line, c.claimedPct),
      recorded: rec && rec.pct === c.claimedPct ? rec : null
    };
  });

  // Earlier overrides on this project become guidance for the readers.
  const decisions = await store.find('decisions', { projectId: project.id });
  const corrections = decisions
    .filter((d) => d.kind === 'line' && d.overrode)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((d) => ({ lineLabel: (linesByKey[d.lineKey] || {}).label || d.lineKey, ai: d.aiDefault, decision: d.decision, reason: d.reason }));

  let readA = { mode: readers.mode, ok: true, findings: [] };
  let readB = readA;
  if (readerClaims.length && photos.length) {
    const bufs = [];
    for (const ph of photos.slice(0, 4)) {
      const got = await photoStore.get(ph.storageKey);
      if (got) bufs.push({ id: ph.id, buffer: got.buffer });
    }
    const input = {
      periodLabel: monthLabel(period),
      claims: readerClaims,
      corrections,
      photos: bufs,
      photoLabels: photos.slice(0, 4).map((p) => `${p.fileName}${p.stampText ? `, printed stamp ${p.stampText}` : ''}`)
    };
    [readA, readB] = await Promise.all([readers.read('A', input), readers.read('B', input)]);
  }

  const find = (r, id) => (r.ok ? cleanFinding((r.findings || []).find((f) => f.claim_id === id)) : null);
  const lines = readerClaims.map((rc) => {
    const line = linesByKey[rc.lineKey];
    const claim = claims.find((c) => c.lineKey === rc.lineKey);
    const a = photos.length ? find(readA, rc.id) : null;
    const b = photos.length ? find(readB, rc.id) : null;
    const comb = photos.length ? combine(line, a, b) : { aiDefault: line.hidden ? 'not_assessable' : 'no_answer', agree: null, note: line.hidden ? PHRASES.hiddenWork : 'No photos for this period.' };
    return {
      lineKey: rc.lineKey,
      claimId: rc.id,
      label: line.label,
      hidden: !!line.hidden,
      statement: rc.statement,
      claimedPct: claim.claimedPct,
      question: rc.question,
      readers: { A: a, B: b },
      ...comb
    };
  });

  const check = {
    runId: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    runAt: new Date().toISOString(),
    runBy: { uid: user.id, name: user.name, role: user.role },
    // gemini (live), saved (a saved Gemini answer replayed), mock (demo readers), needs_code (no live call allowed).
    aiMode: [readA.mode, readB.mode].includes('needs_code') ? 'needs_code' : readA.mode || readers.mode,
    savedRun: readA.mode === 'saved' ? { model: readA.model || null, at: readA.savedAt || null } : null,
    models: { A: readA.model || null, B: readB.model || null },
    ms: { A: readA.ms || 0, B: readB.ms || 0 },
    readerErrors: { A: readA.ok ? null : readA.error, B: readB.ok ? null : readB.error },
    photoIds: photos.map((p) => p.id),
    photoChecks,
    lines
  };
  await store.update('periods', per.id, { check, status: 'checked' });
  return check;
}

module.exports = { runCheck, periodId, getOrCreatePeriod };
