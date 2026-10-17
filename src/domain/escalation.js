// The "fuel gauge". Level 0: nothing to show. Level 1 (yellow): the office sees it first, in the
// Monday view. Level 2 (red): escalated, shown to the mayor. Rules are settings (see config.js).
// Only reviewer-confirmed line decisions can escalate to the mayor; unreviewed AI output never does.
const { KINDS } = require('./deadlines');

function monthLabel(period) {
  const [y, m] = period.split('-').map(Number);
  return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${y}`;
}
function periodKeyLabel(key) {
  if (/^\d{4}-Q\d$/.test(key)) return `${key.slice(5)} ${key.slice(0, 4)}`;
  if (/^\d{4}$/.test(key)) return key;
  return monthLabel(key);
}
function dateLabel(d) {
  const t = new Date(`${d}T00:00:00Z`);
  return `${t.getUTCDate()} ${t.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${t.getUTCFullYear()}`;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// snap: output of services/snapshot.js projectSnapshot()
function escalations(snap, cfg) {
  const items = [];
  const p = snap.project;
  const base = { projectId: p.id, projectName: p.name, inCharge: snap.inChargeName };

  for (const o of snap.obligations) {
    const label = `${KINDS[o.kind].name} for ${periodKeyLabel(o.periodKey)}`;
    if (o.status === 'overdue') {
      const level = o.daysOverdue >= cfg.reportOverdueDays ? 2 : 1;
      items.push({
        ...base,
        kind: 'report_overdue',
        level,
        key: `${o.kind}|${o.periodKey}`,
        title: `${label} not yet submitted`,
        plain: `${p.name}: the ${label} was due on ${dateLabel(o.due)} and has not been logged as submitted. It is ${plural(o.daysOverdue, 'day')} past the deadline.`
      });
    } else if (o.status === 'late' && o.recent) {
      items.push({
        ...base,
        kind: 'report_late',
        level: 1,
        key: `${o.kind}|${o.periodKey}`,
        title: `${label} submitted late`,
        plain: `${p.name}: the ${label} was submitted ${plural(o.daysLate, 'day')} after its deadline. Flagged as late; it does not count as on time.`
      });
    }
  }

  const ms = snap.overdueMilestones[0];
  if (ms) {
    items.push({
      ...base,
      kind: 'milestone_overdue',
      level: ms.daysOverdue >= cfg.milestoneOverdueDays ? 2 : 1,
      key: `ms|${ms.pct}`,
      title: `${ms.pct}% milestone overdue`,
      plain: `${p.name}: the ${ms.pct}% milestone was planned for ${dateLabel(ms.due)}. The office's latest figure is ${ms.actual}%, ${plural(ms.daysOverdue, 'day')} after the planned date.`
    });
  }

  const c = snap.confirmedContradicted;
  if (c && c.count > 0) {
    items.push({
      ...base,
      kind: 'claims_photos_disagree',
      level: c.count >= cfg.contradictedLines ? 2 : 1,
      key: `contra|${c.period}`,
      title: `Photos do not show what was claimed on ${plural(c.count, 'line')} (${monthLabel(c.period)})`,
      plain: `${p.name}: for ${monthLabel(c.period)}, the municipal engineer confirmed that the photos do not show what the progress claim says on ${plural(c.count, 'line item')} (${c.lines.join(', ')}). This calls for a site visit or a talk with the contractor; it is not a conclusion about anyone.`
    });
  }

  if (snap.slippage && snap.slippage.points <= -cfg.laggingPoints) {
    items.push({
      ...base,
      kind: 'lagging',
      level: 1,
      key: 'lag',
      title: `Behind plan by ${Math.abs(snap.slippage.points)} points`,
      plain: `${p.name}: ${snap.slippage.actual}% against a planned ${snap.slippage.planned}% as of ${dateLabel(snap.slippage.asOf)}.`
    });
  }
  if (snap.pendingReview > 0) {
    items.push({ ...base, kind: 'awaiting_review', level: 1, key: 'review', title: `${plural(snap.pendingReview, 'line')} awaiting review`, plain: `${p.name}: ${plural(snap.pendingReview, 'line')} checked and waiting for a person to decide.` });
  }
  if (snap.openPhotoFlags > 0) {
    items.push({ ...base, kind: 'photo_flags', level: 1, key: 'flags', title: `${plural(snap.openPhotoFlags, 'photo check')} flagged for a look`, plain: `${p.name}: ${plural(snap.openPhotoFlags, 'photo check')} flagged (dates, location, reuse or view). Flags are for review only.` });
  }
  if (snap.missingContractorReport) {
    items.push({ ...base, kind: 'no_contractor_report', level: 1, key: 'contractor', title: `No progress claim from the contractor for ${monthLabel(snap.missingContractorReport)}`, plain: `${p.name}: the contractor has not sent a progress claim for ${monthLabel(snap.missingContractorReport)}. If the office writes it, log it as monitoring work.` });
  }
  return items;
}

module.exports = { escalations, monthLabel, periodKeyLabel, dateLabel };
