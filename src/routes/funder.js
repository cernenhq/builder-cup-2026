// The owner and lender view: one read-only page for whoever releases money against progress.
// Per project: the office's percent complete against plan, what a person decided on the latest checked
// month (supported / contradicted / can't tell), what is still open, overdue reports and milestones,
// and the public note. It decides nothing and sends nothing; payment decisions stay with the funder.
const { allSnapshots } = require('../services/snapshot');
const { monthLabel, periodKeyLabel } = require('../domain/escalation');

// The data behind the owner page's overview: per checked month, each claimed line with what a person
// decided (or "waiting"), and the rule-check results of the month's first photo; plus where an inspector
// is needed in the latest checked month. Only stored results are read; nothing is run here.
const RULES = [
  { key: 'stamp_vs_file', label: 'Printed stamp against file date' },
  { key: 'capture_date', label: 'Taken inside the period' },
  { key: 'location', label: 'Location in the file' },
  { key: 'reuse', label: 'Not a reused photo' },
  { key: 'comparable', label: 'Same view as last month' },
  { key: 'web', label: 'Not found online (Cloud Vision)' }
];
function overviewOf(s, checkedDesc) {
  const lines = (s.project.lines || []).map((l) => ({ key: l.key, label: l.label, weight: l.weight || 0, hidden: !!l.hidden }));
  const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
  const months = checkedDesc
    .slice()
    .reverse()
    .map((p) => {
      const pc = (p.check.photoChecks || [])[0];
      const rules = {};
      for (const f of (pc && pc.findings) || []) {
        const key = RULES.find((r) => r.key === f.key) ? f.key : /web|online|vision/i.test(f.key) ? 'web' : null;
        if (key) rules[key] = { level: f.level, title: f.title };
      }
      return {
        period: p.period,
        label: monthLabel(p.period),
        stale: !!p.checkStale,
        photoId: (p.check.photoIds || [])[0] || null,
        lines: (p.check.lines || []).map((l) => {
          const d = s.effective.get(`${p.period}|${l.lineKey}`);
          return { key: l.lineKey, label: (byKey[l.lineKey] || {}).label || l.label, claimedPct: l.claimedPct, hidden: !!l.hidden, decision: d ? d.decision : null, aiDefault: l.aiDefault };
        }),
        rules
      };
    });
  // Where to send an inspector: lines in the latest checked month a photo did not settle. A pin goes
  // where a reader drew its evidence box; hidden work has no place in the photo, so it has no pin.
  const last = checkedDesc[0];
  const inspect = [];
  if (last) {
    for (const l of last.check.lines || []) {
      const d = s.effective.get(`${last.period}|${l.lineKey}`);
      const decision = d ? d.decision : null;
      if (decision === 'supported') continue;
      const r = l.readers || {};
      const box = (r.A && r.A.box) || (r.B && r.B.box) || null;
      const why = l.hidden
        ? 'Hidden work: the camera cannot see it. Needs a site visit or interior photos.'
        : decision === 'contradicted'
          ? 'Claimed, but the photo shows otherwise. Confirm on site before it is counted.'
          : decision === 'not_assessable'
            ? "The photo cannot show it. Confirm on site."
            : 'Still waiting for a person in the office to decide.';
      inspect.push({ key: l.lineKey, label: (byKey[l.lineKey] || {}).label || l.label, decision, why, pin: box ? { y: (box[0] + box[2]) / 20, x: (box[1] + box[3]) / 20 } : null });
    }
  }
  return { contractAmount: s.project.contractAmount || null, lines, months, rules: RULES, inspect, inspectPeriod: last ? { period: last.period, label: monthLabel(last.period), photoId: (last.check.photoIds || [])[0] || null } : null };
}

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
        hasOverlay: s.project.id === 'P-001',
        overview: overviewOf(s, checked),
        // Site photos per month (the office's photos, not transmittal receipts), for Lens, Swipe and Change map.
        photosByMonth: (() => {
          const out = {};
          const checkedPhoto = Object.fromEntries(checked.map((p) => [p.period, (p.check.photoIds || [])[0]]));
          for (const p of s.data.periods || []) {
            const id = checkedPhoto[p.period];
            if (id) out[p.period] = { period: p.period, label: monthLabel(p.period), photoId: id };
          }
          return Object.values(out).sort((a, b) => b.period.localeCompare(a.period));
        })()
      };
    });
    res.json({ today: today(), projects, note: 'Read only. What a person in the office decided, not an AI verdict. Payment decisions stay with you.' });
  }));
};
