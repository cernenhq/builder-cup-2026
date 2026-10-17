// Planned progress, slippage and milestones. Plain arithmetic, no AI.
// Slippage = office percent complete minus planned percent at the same date, in points
// (the term Philippine public works uses). Which thresholds trigger warnings is a setting.
const { daysBetween, monthEnd } = require('./deadlines');

// The plan is a start date at 0% and milestones [{pct, due}], joined by straight lines.
function plannedAt(project, date) {
  const pts = [{ pct: 0, due: project.startDate }, ...(project.milestones || [])].sort((a, b) => a.due.localeCompare(b.due));
  if (date <= pts[0].due) return 0;
  for (let i = 1; i < pts.length; i++) {
    if (date <= pts[i].due) {
      const span = daysBetween(pts[i - 1].due, pts[i].due) || 1;
      const t = daysBetween(pts[i - 1].due, date) / span;
      return Math.round((pts[i - 1].pct + t * (pts[i].pct - pts[i - 1].pct)) * 10) / 10;
    }
  }
  return pts[pts.length - 1].pct;
}

// The latest office entry across a project's periods: { value, period, asOf, enteredBy }.
function latestPercent(periods) {
  const withPct = periods.filter((p) => p.percentComplete && typeof p.percentComplete.value === 'number');
  withPct.sort((a, b) => a.period.localeCompare(b.period));
  const p = withPct[withPct.length - 1];
  if (!p) return null;
  return { value: p.percentComplete.value, period: p.period, asOf: monthEnd(p.period), enteredBy: p.percentComplete.enteredBy, enteredAt: p.percentComplete.enteredAt };
}

function slippage(project, latest, today) {
  if (!latest) return null;
  const asOf = latest.asOf < today ? latest.asOf : today;
  const planned = plannedAt(project, asOf);
  return { asOf, planned, actual: latest.value, points: Math.round((latest.value - planned) * 10) / 10 };
}

// Milestones whose planned date has passed while the office's latest figure is below them.
function overdueMilestones(project, latest, today) {
  const actual = latest ? latest.value : 0;
  return (project.milestones || [])
    .filter((m) => m.due < today && actual < m.pct)
    .map((m) => ({ pct: m.pct, due: m.due, daysOverdue: daysBetween(m.due, today), actual }));
}

function projectStatusWord(pct) {
  if (pct == null || pct <= 0) return 'Not yet started';
  if (pct >= 100) return 'Completed';
  return 'Ongoing';
}

module.exports = { plannedAt, latestPercent, slippage, overdueMilestones, projectStatusWord };
