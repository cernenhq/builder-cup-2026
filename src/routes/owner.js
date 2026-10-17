// Owner and office-head routes: schedule trajectory and the plan-over-photo data.
// Registered from app.js. Read-only: nothing here writes.
const { finishRange, planPoints, plannedFinish, monthName } = require('../domain/trajectory');
const { plannedAt } = require('../domain/progress');
const { monthEnd, monthsBetween } = require('../domain/deadlines');
const { effectiveDecisions } = require('../services/snapshot');

const TIMELINE_FROM_DEFAULT = '2025-06';
const TIMELINE_TO_DEFAULT = '2027-08';

module.exports = function registerOwnerRoutes(app, { store, allow, wrap, today, config }) { // eslint-disable-line no-unused-vars
  app.get('/api/owner/projects/:id/trajectory', allow('reviewer', 'engineer', 'auditor'), wrap(async (req, res) => {
    const project = await store.get('projects', req.params.id);
    if (!project) return res.status(404).json({ error: 'No such project.' });
    const [periods, photos, decisions] = await Promise.all([
      store.find('periods', { projectId: project.id }),
      store.find('photos', { projectId: project.id }),
      store.find('decisions', { projectId: project.id })
    ]);
    const now = today();
    const eff = effectiveDecisions(decisions, periods);

    // The office's percent complete, month by month.
    const history = periods
      .filter((p) => p.percentComplete && typeof p.percentComplete.value === 'number')
      .map((p) => ({ period: p.period, value: p.percentComplete.value, enteredBy: p.percentComplete.enteredByName || p.percentComplete.enteredBy || null }))
      .sort((a, b) => a.period.localeCompare(b.period));
    const trajectory = finishRange(project, history);

    // Photos the office keeps for each month (transmittal receipts are not site photos).
    const sitePhotos = photos.filter((p) => p.source !== 'transmittal').sort((a, b) => a.period.localeCompare(b.period) || a.createdAt.localeCompare(b.createdAt));
    const photoOf = (period) => sitePhotos.find((p) => p.period === period) || null;
    const checked = periods.filter((p) => p.check).sort((a, b) => a.period.localeCompare(b.period));
    const latestChecked = checked[checked.length - 1] || null;
    let latestPhoto = null;
    if (latestChecked) {
      const id = (latestChecked.check.photoIds || [])[0];
      latestPhoto = sitePhotos.find((p) => p.id === id) || photoOf(latestChecked.period);
    }

    // Timeline: Jun 2025 to Aug 2027 by default, stretched if the project or the finish range needs it.
    const first = [project.firstPeriod || TIMELINE_FROM_DEFAULT, TIMELINE_FROM_DEFAULT].sort()[0];
    const rangeTo = trajectory.ok && trajectory.range.to ? trajectory.range.to.slice(0, 7) : TIMELINE_TO_DEFAULT;
    const last = [TIMELINE_TO_DEFAULT, rangeTo, plannedFinish(project).slice(0, 7)].sort().pop();
    const months = monthsBetween(first, last);

    // Per line, what the reviewer's latest decisions confirm as of each month (carried forward).
    const lineMeta = (project.lines || []).map((l) => ({ key: l.key, label: l.label, hidden: !!l.hidden }));
    const state = {};
    let ci = 0;
    let lastPhoto = null;
    const monthRows = months.map((m) => {
      while (ci < checked.length && checked[ci].period <= m) {
        const per = checked[ci];
        for (const l of per.check.lines || []) {
          const s = state[l.lineKey] || (state[l.lineKey] = { confirmedPct: null, confirmedPeriod: null, lastClaimPct: null, lastClaimPeriod: null, lastDecision: null, lastDecisionPct: null, lastDecisionPeriod: null });
          s.lastClaimPct = l.claimedPct;
          s.lastClaimPeriod = per.period;
          const d = eff.get(`${per.period}|${l.lineKey}`);
          if (d) {
            s.lastDecision = d.decision;
            s.lastDecisionPct = typeof l.claimedPct === 'number' ? l.claimedPct : null;
            s.lastDecisionPeriod = per.period;
            if (d.decision === 'supported' && typeof l.claimedPct === 'number') {
              s.confirmedPct = l.claimedPct;
              s.confirmedPeriod = per.period;
            }
          }
        }
        ci++;
      }
      const ph = photoOf(m);
      if (ph && m <= (latestChecked ? latestChecked.period : '')) lastPhoto = ph;
      const hist = history.find((h) => h.period === m);
      return {
        period: m,
        label: monthName(`${m}-01`),
        planned: plannedAt(project, monthEnd(m)),
        office: hist ? hist.value : null,
        checked: checked.some((p) => p.period === m),
        photo: lastPhoto ? { id: lastPhoto.id, period: lastPhoto.period, url: `/api/photos/${lastPhoto.id}`, own: lastPhoto.period === m } : null,
        lines: JSON.parse(JSON.stringify(state))
      };
    });

    res.json({
      projectId: project.id,
      name: project.name,
      today: now,
      startDate: project.startDate,
      plannedFinish: plannedFinish(project),
      plan: planPoints(project),
      history,
      trajectory,
      overlay: {
        period: latestChecked ? latestChecked.period : null,
        label: latestChecked ? monthName(`${latestChecked.period}-01`) : null,
        photo: latestPhoto ? { id: latestPhoto.id, period: latestPhoto.period, url: `/api/photos/${latestPhoto.id}`, stampText: latestPhoto.stampText || null } : null,
        plannedNow: latestChecked ? plannedAt(project, monthEnd(latestChecked.period)) : null,
        officeNow: trajectory.ok ? trajectory.actual : null,
        officePeriod: trajectory.ok ? trajectory.latestPeriod : null,
        hasModel: project.id === 'P-001'
      },
      lines: lineMeta,
      timeline: { from: first, to: last, mark: latestChecked ? latestChecked.period : null, months: monthRows }
    });
  }));
};
