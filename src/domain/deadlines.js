// Report deadlines and late logic. Pure functions on calendar dates (YYYY-MM-DD).
//
// Demo settings for a typical municipal engineering office (adjust to the office's own rules; see README "Decisions to check").
// DILG SubayBAYAN milestone reporting with geotagged photos: DILG MC 2024-134. The other due dates are configurable assumptions:
// - DILG SubayBAYAN: monthly, due BEFORE the 25th of the reporting month. Submitted on the 24th is on
//   time; on the 25th or later is late.
// - COA: monthly, due 5 working days after the month closes.
// - IAS (internal audit) and MPDO consolidated: quarterly, due 5 working days after the quarter closes.
// - Year-end report: due on 15 December of the year.
// - A report submitted after its due date is flagged as late and is NOT counted as submitted on time.

// Philippine non-working days for 2025 and 2026 (regular and special non-working).
// Movable Islamic holidays are declared each year and are not listed: add them here when proclaimed.
const HOLIDAYS = new Set([
  '2025-01-01', '2025-01-29', '2025-04-09', '2025-04-17', '2025-04-18', '2025-04-19', '2025-05-01',
  '2025-06-12', '2025-08-21', '2025-08-25', '2025-10-31', '2025-11-01', '2025-11-30', '2025-12-08',
  '2025-12-24', '2025-12-25', '2025-12-30', '2025-12-31',
  '2026-01-01', '2026-02-17', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-09', '2026-05-01',
  '2026-06-12', '2026-08-21', '2026-08-31', '2026-11-01', '2026-11-02', '2026-11-30', '2026-12-08',
  '2026-12-24', '2026-12-25', '2026-12-30', '2026-12-31'
]);

const KINDS = {
  SUBAYBAYAN: { name: 'DILG SubayBAYAN update', agency: 'DILG', cadence: 'monthly' },
  COA: { name: 'COA monthly report', agency: 'COA', cadence: 'monthly' },
  IAS: { name: 'IAS quarterly report', agency: 'Internal Audit Service', cadence: 'quarterly' },
  MPDO: { name: 'MPDO consolidated report', agency: 'MPDO', cadence: 'quarterly' },
  YEAR_END: { name: 'Year-end report', agency: 'MPDO and Mayor', cadence: 'yearly' }
};
const PERIOD_REPORT_KINDS = ['COA', 'SUBAYBAYAN', 'IAS', 'MPDO'];

function parse(d) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}
function fmt(dt) {
  return dt.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const t = parse(d);
  t.setUTCDate(t.getUTCDate() + n);
  return fmt(t);
}
function daysBetween(a, b) {
  return Math.round((parse(b) - parse(a)) / 86400000);
}
function isWorkingDay(d, holidays = HOLIDAYS) {
  const wd = parse(d).getUTCDay();
  return wd !== 0 && wd !== 6 && !holidays.has(d);
}
// The n-th working day strictly after date d.
function addWorkingDays(d, n, holidays = HOLIDAYS) {
  let cur = d;
  let count = 0;
  while (count < n) {
    cur = addDays(cur, 1);
    if (isWorkingDay(cur, holidays)) count++;
  }
  return cur;
}
function monthEnd(period) {
  const [y, m] = period.split('-').map(Number);
  return fmt(new Date(Date.UTC(y, m, 0)));
}
function quarterOf(period) {
  const [y, m] = period.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}
function quarterEnd(q) {
  const [y, qq] = q.split('-Q').map(Number);
  return monthEnd(`${y}-${String(qq * 3).padStart(2, '0')}`);
}
function periodKeyFor(kind, period) {
  if (kind === 'IAS' || kind === 'MPDO') return quarterOf(period);
  if (kind === 'YEAR_END') return period.slice(0, 4);
  return period;
}

// Due date for an obligation (kind + period key). Returns the last on-time date.
function dueDate(kind, periodKey, holidays = HOLIDAYS) {
  switch (kind) {
    case 'SUBAYBAYAN':
      return `${periodKey}-24`; // before the 25th
    case 'COA':
      return addWorkingDays(monthEnd(periodKey), 5, holidays);
    case 'IAS':
    case 'MPDO':
      return addWorkingDays(quarterEnd(periodKey), 5, holidays);
    case 'YEAR_END':
      return `${periodKey}-12-15`;
    default:
      throw new Error(`Unknown report kind ${kind}`);
  }
}

// Status of one obligation given its transmittals (only submittedOn dates matter).
// on_time: submitted on or before the due date (counted).
// late: submitted after the due date (flagged, not counted as on time).
// overdue: not submitted and the due date has passed.
// due_soon: not submitted, due within the next 7 days. upcoming: later than that.
function obligationStatus(due, transmittals, today) {
  const sorted = [...(transmittals || [])].sort((a, b) => a.submittedOn.localeCompare(b.submittedOn));
  const first = sorted[0];
  if (first) {
    const late = first.submittedOn > due;
    return {
      status: late ? 'late' : 'on_time',
      submittedOn: first.submittedOn,
      daysLate: late ? daysBetween(due, first.submittedOn) : 0,
      countsAsOnTime: !late
    };
  }
  const daysToDue = daysBetween(today, due);
  if (daysToDue < 0) return { status: 'overdue', daysOverdue: -daysToDue, countsAsOnTime: false };
  return { status: daysToDue <= 7 ? 'due_soon' : 'upcoming', daysToDue, countsAsOnTime: false };
}

// Compliance over a set of obligation statuses. Late reports are flagged and not counted.
function compliance(statuses) {
  const due = statuses.filter((s) => s.status !== 'upcoming' && s.status !== 'due_soon');
  const onTime = due.filter((s) => s.status === 'on_time').length;
  const late = due.filter((s) => s.status === 'late').length;
  const overdue = due.filter((s) => s.status === 'overdue').length;
  return { due: due.length, onTime, lateFlagged: late, overdue, onTimeRate: due.length ? onTime / due.length : null };
}

// Every month from start period to end period inclusive.
function monthsBetween(startPeriod, endPeriod) {
  const out = [];
  let [y, m] = startPeriod.split('-').map(Number);
  const [ey, em] = endPeriod.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

// All obligations for a project from its first reporting month up to the month of `today`,
// limited to those due on or before today + horizonDays.
function obligationsFor(project, today, horizonDays = 14) {
  const lastPeriod = today.slice(0, 7);
  const months = monthsBetween(project.firstPeriod, lastPeriod);
  const keys = new Map();
  const add = (kind, key) => keys.set(`${kind}|${key}`, { kind, periodKey: key });
  for (const p of months) {
    add('SUBAYBAYAN', p);
    add('COA', p);
    add('IAS', quarterOf(p));
    add('MPDO', quarterOf(p));
    add('YEAR_END', p.slice(0, 4));
  }
  const limit = addDays(today, horizonDays);
  return [...keys.values()]
    .map((o) => ({ ...o, due: dueDate(o.kind, o.periodKey), name: KINDS[o.kind].name }))
    .filter((o) => o.due <= limit)
    .sort((a, b) => a.due.localeCompare(b.due));
}

function weekRange(today) {
  // Monday to Sunday of the week containing today.
  const wd = parse(today).getUTCDay();
  const monday = addDays(today, wd === 0 ? -6 : 1 - wd);
  return { start: monday, end: addDays(monday, 6) };
}

module.exports = {
  HOLIDAYS,
  KINDS,
  PERIOD_REPORT_KINDS,
  addDays,
  daysBetween,
  isWorkingDay,
  addWorkingDays,
  monthEnd,
  quarterOf,
  quarterEnd,
  periodKeyFor,
  dueDate,
  obligationStatus,
  compliance,
  monthsBetween,
  obligationsFor,
  weekRange
};
