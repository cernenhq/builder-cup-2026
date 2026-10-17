// Schedule trajectory: standard schedule formulas on the office's monthly percent complete against
// the milestone plan. Plain arithmetic, no AI. Every function returns the inputs it used, so the
// screen can list them and anyone can re-type them into a public calculator.
//
// Units: percent complete is 0 to 100. Time is in months, where one month = 30.4375 days
// (365.25 / 12). Dates are ISO strings (YYYY-MM-DD).
// No cost data comes from photos, so cost measures (CPI, estimate at completion) are left out.
const { addDays, daysBetween, monthEnd } = require('./deadlines');
const { plannedAt } = require('./progress');

const DAYS_PER_MONTH = 30.4375;
const r1 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 10) / 10);
const r2 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 100) / 100);
const r3 = (v) => (v == null || !isFinite(v) ? null : Math.round(v * 1000) / 1000);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthName(date) {
  if (!date) return null;
  const [y, m] = date.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
const monthsSince = (from, date) => daysBetween(from, date) / DAYS_PER_MONTH;
const dateAfterMonths = (from, months) => addDays(from, Math.round(months * DAYS_PER_MONTH));

// Earned value schedule measures (as in the Omni EVM calculator): SPI = EV / PV, SV = (EV - PV) / PV.
// pv and ev in any one unit (percent of scope here).
function evm(pv, ev) {
  return {
    spi: pv > 0 ? ev / pv : null,
    sv: pv > 0 ? (ev - pv) / pv : null,
    inputs: { pv, ev },
    formula: 'SPI = EV / PV; SV = (EV - PV) / PV'
  };
}

// Slippage in points (the term Philippine public works uses): actual minus planned.
function slippagePoints(planned, actual) {
  return { points: r1(actual - planned), inputs: { planned, actual }, formula: 'slippage = actual % - planned %' };
}

// The plan as points: start at 0% and each milestone, joined by straight lines (src/domain/progress.js).
function planPoints(project) {
  return [{ pct: 0, due: project.startDate }, ...(project.milestones || [])].sort((a, b) => a.due.localeCompare(b.due)).map((p) => ({ date: p.due, pct: p.pct }));
}
function plannedFinish(project) {
  const pts = planPoints(project);
  const full = pts.find((p) => p.pct >= 100);
  return (full || pts[pts.length - 1]).date;
}

// Earned schedule (Lipke 2003). ES = C + (EV - PV_C) / (PV_C+1 - PV_C), where C is the number of whole
// months of the plan whose planned value has been earned. SPI(t) = ES / AT. Finish: IEAC(t) = PD / SPI(t).
function earnedSchedule(project, asOf, ev) {
  const start = project.startDate;
  const pd = monthsSince(start, plannedFinish(project));
  const at = monthsSince(start, asOf);
  const pvAt = (k) => plannedAt(project, dateAfterMonths(start, k));
  let c = 0;
  const maxK = Math.ceil(pd) + 1;
  for (let k = 0; k <= maxK; k++) {
    if (pvAt(k) <= ev + 1e-9) c = k;
    else break;
  }
  const pvC = pvAt(c);
  const pvC1 = pvAt(c + 1);
  const es = Math.max(0, c + (pvC1 > pvC ? (ev - pvC) / (pvC1 - pvC) : 0));
  const spiT = at > 0 ? es / at : null;
  const ieac = spiT > 0 ? pd / spiT : null;
  return {
    es,
    at,
    pd,
    spiT,
    ieac,
    finish: ieac != null ? dateAfterMonths(start, ieac) : null,
    planReachedOn: dateAfterMonths(start, es),
    inputs: { start, asOf, ev, c, pvC: r1(pvC), pvC1: r1(pvC1), at: r2(at), pd: r2(pd), plannedFinish: plannedFinish(project) },
    formula: 'ES = C + (EV - PV_C) / (PV_C+1 - PV_C); SPI(t) = ES / AT; finish = start + PD / SPI(t)'
  };
}

// Ordinary least squares y = a x + b, with R squared and the standard error of the estimate.
function linearFit(points) {
  const n = points.length;
  if (n < 2) return { a: null, b: null, r2: null, se: null, n, inputs: { points } };
  const mx = points.reduce((s, p) => s + p[0], 0) / n;
  const my = points.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  const a = sxx > 0 ? sxy / sxx : null;
  const b = a == null ? null : my - a * mx;
  const sse = a == null ? null : points.reduce((s, [x, y]) => s + (y - (a * x + b)) ** 2, 0);
  return { a, b, r2: syy > 0 && sse != null ? 1 - sse / syy : 1, se: n > 2 && sse != null ? Math.sqrt(sse / (n - 2)) : 0, n, inputs: { points } };
}

// Three-point estimate (as in the Omni PERT calculator): TE = (O + 4M + P) / 6, SD = (P - O) / 6.
function threePoint(o, m, p) {
  return { te: (o + 4 * m + p) / 6, sd: (p - o) / 6, inputs: { o, m, p }, formula: 'TE = (O + 4M + P) / 6; SD = (P - O) / 6' };
}

function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

// The office's percent-complete history as fit points: x = month number since the first entry
// (0 = first entry's month), y = percent complete.
function historyPoints(history) {
  const h = [...history].filter((e) => typeof e.value === 'number').sort((a, b) => a.period.localeCompare(b.period));
  if (!h.length) return { base: null, points: [] };
  const [y0, m0] = h[0].period.split('-').map(Number);
  const idx = (p) => {
    const [y, m] = p.split('-').map(Number);
    return (y - y0) * 12 + (m - m0);
  };
  return { base: h[0].period, points: h.map((e) => [idx(e.period), e.value]) };
}

// Finish at the pace of the last `window` office entries (straight-line fit, extended to 100%).
function paceFinish(history, window) {
  const { base, points } = historyPoints(history);
  const win = points.slice(-window);
  const fit = linearFit(win);
  const baseEnd = base ? monthEnd(base) : null;
  const x100 = fit.a > 0 ? (100 - fit.b) / fit.a : null;
  return {
    window: win.length,
    fit,
    x100,
    finish: x100 != null && baseEnd ? dateAfterMonths(baseEnd, x100) : null,
    inputs: { base, points: win, unit: 'x = months since the first entry, y = percent complete' },
    formula: 'y = a x + b; finish where y = 100'
  };
}

// All methods together, and the finish as a range because the methods disagree.
// history: [{ period: 'YYYY-MM', value: percent }]. asOf defaults to the end of the latest entry's month.
function finishRange(project, history, opts = {}) {
  const h = [...history].filter((e) => typeof e.value === 'number').sort((a, b) => a.period.localeCompare(b.period));
  if (!h.length) return { ok: false, reason: 'No percent-complete entries yet.' };
  const latest = h[h.length - 1];
  const asOf = opts.asOf || monthEnd(latest.period);
  const ev = latest.value;
  const pv = plannedAt(project, asOf);
  const handover = plannedFinish(project);
  const E = evm(pv, ev);
  const slip = slippagePoints(pv, ev);
  const ES = earnedSchedule(project, asOf, ev);
  const windows = (opts.windows || [4, 6, 9]).map((w) => paceFinish(h, w));
  const mid = windows[Math.floor(windows.length / 2)];
  const baseEnd = monthEnd(h[0].period);
  const xs = windows.map((w) => w.x100).filter((x) => x != null);
  let P3 = null;
  if (xs.length === windows.length && mid.x100 != null) {
    const sorted = [...xs].sort((a, b) => a - b);
    const o = sorted[0];
    const p = sorted[sorted.length - 1];
    const m = sorted[Math.floor(sorted.length / 2)];
    P3 = threePoint(o, m, p);
    P3.finish = dateAfterMonths(baseEnd, P3.te);
    P3.sdDays = Math.round(P3.sd * DAYS_PER_MONTH);
    P3.optimistic = dateAfterMonths(baseEnd, o);
    P3.pessimistic = dateAfterMonths(baseEnd, p);
    const handoverX = monthsSince(baseEnd, handover);
    P3.pOnTime = P3.sd > 0 ? normCdf((handoverX - P3.te) / P3.sd) : P3.te <= handoverX ? 1 : 0;
    P3.gapDays = daysBetween(handover, P3.finish);
  }

  const candidates = [ES.finish, P3 && P3.optimistic, P3 && P3.pessimistic].filter(Boolean).sort();
  const from = candidates[0] || null;
  const to = candidates[candidates.length - 1] || null;
  const agree = ES.finish && mid.finish ? Math.abs(daysBetween(ES.finish, mid.finish)) <= 92 : false;
  const fromLabel = monthName(from);
  const toLabel = monthName(to);

  const pct = (v) => `${r1(v)}%`;
  const methods = [
    {
      key: 'spi',
      name: 'Schedule performance index (SPI)',
      formula: E.formula.split(';')[0],
      inputs: { ev, pv: r1(pv), asOf },
      inputsText: `EV (office percent complete, ${latest.period}) ${pct(ev)}; PV (planned by ${asOf}) ${pct(pv)}`,
      result: r3(E.spi),
      resultText: `${r2(E.spi)}${E.spi < 1 ? ' (behind the plan)' : ' (on or ahead of the plan)'}`,
      check: { label: 'Omni EVM calculator', url: 'https://www.omnicalculator.com/finance/earned-value-management' }
    },
    {
      key: 'sv',
      name: 'Schedule variance',
      formula: 'SV = (EV - PV) / PV',
      inputs: { ev, pv: r1(pv) },
      inputsText: 'same as above',
      result: r2(E.sv * 100),
      resultText: `${r1(E.sv * 100)}%`,
      check: { label: 'Omni EVM calculator', url: 'https://www.omnicalculator.com/finance/earned-value-management' }
    },
    {
      key: 'slippage',
      name: 'Slippage',
      formula: slip.formula,
      inputs: { actual: ev, planned: r1(pv) },
      inputsText: 'same as above',
      result: slip.points,
      resultText: `${slip.points > 0 ? '+' : ''}${slip.points} points`,
      check: { label: 'Simple subtraction', url: null }
    },
    {
      key: 'es',
      name: 'Earned schedule and finish',
      formula: ES.formula,
      inputs: ES.inputs,
      inputsText: `start ${ES.inputs.start}; C = ${ES.inputs.c} whole months of plan earned (PV_C ${ES.inputs.pvC}%, PV_C+1 ${ES.inputs.pvC1}%); AT ${ES.inputs.at} months; PD ${ES.inputs.pd} months (planned finish ${handover})`,
      result: { es: r2(ES.es), spiT: r3(ES.spiT), finish: ES.finish },
      resultText: `ES ${r1(ES.es)} months (the plan reached ${pct(ev)} in ${monthName(ES.planReachedOn)}); SPI(t) ${r2(ES.spiT)}; finish about ${monthName(ES.finish) || 'not reached'}`,
      check: { label: 'Lipke (2003), earned schedule', url: null }
    },
    {
      key: 'pace',
      name: `Pace, last ${mid.window} months`,
      formula: mid.formula,
      inputs: mid.inputs,
      inputsText: `${mid.inputs.unit}; points ${mid.inputs.points.map(([x, y]) => `(${x}, ${y})`).join(' ')}`,
      result: { a: r2(mid.fit.a), r2: r2(mid.fit.r2), finish: mid.finish },
      resultText: mid.finish ? `a = ${r2(mid.fit.a)} points a month, R² ${r2(mid.fit.r2)}; reaches 100% about ${monthName(mid.finish)}` : 'no progress in this window, so no finish at this pace',
      check: { label: 'Omni linear regression', url: 'https://www.omnicalculator.com/statistics/linear-regression' }
    },
    {
      key: 'pert',
      name: 'Three-point estimate',
      formula: 'TE = (O + 4M + P) / 6; SD = (P - O) / 6',
      inputs: P3 ? { o: r2(P3.inputs.o), m: r2(P3.inputs.m), p: r2(P3.inputs.p), windows: windows.map((w) => w.window), base: h[0].period } : null,
      inputsText: P3
        ? `O, M, P = months after ${baseEnd} to reach 100% at the pace of the last ${windows.map((w) => w.window).join(', ')} months (earliest, middle, latest): ${[P3.inputs.o, P3.inputs.m, P3.inputs.p].map((v) => r2(v)).join(', ')}`
        : 'not enough progress to fit',
      result: P3 ? { te: r2(P3.te), sd: r2(P3.sd), finish: P3.finish, pOnTime: r3(P3.pOnTime), gapDays: P3.gapDays } : null,
      resultText: P3 ? `TE ${monthName(P3.finish)}, SD ${r1(P3.sd)} months; ${P3.gapDays} days after the planned finish` : 'n/a',
      check: { label: 'Omni PERT calculator', url: 'https://www.omnicalculator.com/other/pert' }
    }
  ];

  return {
    ok: true,
    asOf,
    plannedNow: r1(pv),
    actual: ev,
    latestPeriod: latest.period,
    plannedFinish: handover,
    spi: r3(E.spi),
    sv: r3(E.sv),
    slippage: slip.points,
    spiT: r3(ES.spiT),
    methods,
    windows: windows.map((w) => ({ window: w.window, a: r2(w.fit.a), r2: r2(w.fit.r2), finish: w.finish })),
    range: { from, to, fromLabel, toLabel, text: fromLabel && toLabel ? (fromLabel === toLabel ? fromLabel : `${fromLabel} to ${toLabel}`) : null },
    agree,
    note: agree
      ? 'Earned schedule and the pace fit are within three months of each other.'
      : 'Earned schedule and the pace fit are more than three months apart, so the finish is quoted as a range, not a date.'
  };
}

module.exports = { DAYS_PER_MONTH, evm, slippagePoints, planPoints, plannedFinish, earnedSchedule, linearFit, threePoint, paceFinish, historyPoints, finishRange, monthName, normCdf };
