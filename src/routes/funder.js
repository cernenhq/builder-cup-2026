// The owner and lender view: one read-only page for whoever releases money against progress.
// Per project: the office's percent complete against plan, what a person decided on the latest checked
// month (supported / contradicted / can't tell), what is still open, overdue reports and milestones,
// and the public note. It decides nothing and sends nothing; payment decisions stay with the funder.
const { allSnapshots } = require('../services/snapshot');
const { monthLabel, periodKeyLabel } = require('../domain/escalation');

module.exports = function registerFunderRoutes(app, { allow, wrap, today, config, store }) {
  app.get('/api/funder/overview', allow('funder'), wrap(async (req, res) => {
    const { snaps } = await allSnapshots(store, today(), config.escalation);
    const projects = snaps.map((s) => {
      const checked = s.data.periods.filter((p) => p.check).sort((a, b) => b.period.localeCompare(a.period));
      const last = checked[0] || null;
      const counts = { supported: 0, contradicted: 0, not_assessable: 0, waiting: 0 };
      if (last) {
        for (const l of last.check.lines) {
          const d = s.effective.get(`${last.period}|${l.lineKey}`);
          if (d) counts[d.decision] = (counts[d.decision] || 0) + 1;
          else counts.waiting++;
        }
      }
      return {
        id: s.project.id,
        name: s.project.name,
        location: s.project.location,
        contractor: s.project.contractor,
        fictional: !!s.project.fictional,
        percent: s.latest ? { value: s.latest.value, asOf: s.latest.asOf } : null,
        plannedToday: s.plannedToday,
        slippage: s.slippage,
        latestChecked: last ? { period: last.period, label: monthLabel(last.period), stale: !!last.checkStale, counts } : null,
        overdueMilestones: s.overdueMilestones.map((m) => ({ pct: m.pct, due: m.due })),
        overdueReports: s.obligations.filter((o) => o.status === 'overdue').map((o) => `${o.name}, ${periodKeyLabel(o.periodKey)}`),
        hasOverlay: s.project.id === 'P-001'
      };
    });
    res.json({ today: today(), projects, note: 'Read only. What a person in the office decided, not an AI verdict. Payment decisions stay with you.' });
  }));
};
