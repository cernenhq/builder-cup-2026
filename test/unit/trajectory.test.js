// Schedule trajectory: standard formulas, each checked against a worked example or hand arithmetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../src/domain/trajectory');
const D = require('../../src/seed/demo-data');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} +/- ${tol}, got ${a}`);

test('EVM matches the Omni worked example: PV 1475, EV 1300 gives SPI 0.881 and SV -11.86%', () => {
  const r = T.evm(1475, 1300);
  near(r.spi, 0.881, 0.0005, 'SPI');
  near(r.sv * 100, -11.86, 0.005, 'SV %');
  assert.deepEqual(r.inputs, { pv: 1475, ev: 1300 });
  assert.equal(T.evm(0, 10).spi, null, 'no plan yet, no index');
});

test('slippage is actual minus planned, in points', () => {
  assert.equal(T.slippagePoints(73.3, 68).points, -5.3);
  assert.equal(T.slippagePoints(50, 52).points, 2);
});

test('linear fit returns slope, intercept and R squared', () => {
  const exact = T.linearFit([[0, 1], [1, 3], [2, 5], [3, 7]]);
  near(exact.a, 2, 1e-9);
  near(exact.b, 1, 1e-9);
  near(exact.r2, 1, 1e-9);
  // Hand-worked: x 1..5, y 2,4,5,4,5 -> a 0.6, b 2.2, R^2 0.6
  const f = T.linearFit([[1, 2], [2, 4], [3, 5], [4, 4], [5, 5]]);
  near(f.a, 0.6, 1e-9);
  near(f.b, 2.2, 1e-9);
  near(f.r2, 0.6, 1e-9);
  assert.equal(f.inputs.points.length, 5);
});

test('three-point estimate follows (O + 4M + P) / 6 and (P - O) / 6', () => {
  const r = T.threePoint(4, 6, 14);
  near(r.te, 7, 1e-9);
  near(r.sd, 10 / 6, 1e-9);
  assert.deepEqual(r.inputs, { o: 4, m: 6, p: 14 });
});

test('earned schedule on a straight-line plan: half the work at month 6 of a 12-month plan earns 6 months', () => {
  const project = { startDate: '2025-01-01', milestones: [{ pct: 100, due: '2026-01-01' }] };
  // One year = 12 months of 30.4375 days. At month 8 the plan is at 66.7%; 50% earned means ES = 6.
  const asOf = '2025-08-31';
  const r = T.earnedSchedule(project, asOf, 50);
  near(r.es, 6, 0.05, 'ES');
  near(r.spiT, r.es / r.at, 1e-9, 'SPI(t)');
  near(r.ieac, r.pd / r.spiT, 1e-9, 'IEAC(t)');
  assert.ok(r.finish > '2026-01-01', 'late job finishes after the plan');
  assert.equal(r.inputs.ev, 50);
});

test('P-001 demo: trajectory from the milestone plan and the office percent history', () => {
  const p = D.PROJECTS.find((x) => x.id === 'P-001');
  const history = Object.entries(D.P001_PERCENT).map(([period, value]) => ({ period, value }));
  const r = T.finishRange(p, history);
  assert.equal(r.ok, true);
  assert.equal(r.asOf, '2026-04-30');
  assert.equal(r.actual, 68);
  assert.equal(r.plannedNow, 73.3);
  near(r.spi, 0.928, 0.001, 'SPI');
  assert.equal(r.slippage, -5.3);
  assert.ok(r.spiT < 1 && r.spiT > 0.8, 'time-based SPI behind');
  // The finish is quoted as a range across methods, in months.
  assert.match(r.range.text, /^[A-Z][a-z]{2} 20\d\d to [A-Z][a-z]{2} 20\d\d$/);
  assert.ok(r.range.from >= r.plannedFinish, 'the range starts after the planned finish');
  // Every method lists its inputs.
  for (const m of r.methods) {
    assert.ok(m.name && m.formula && m.inputsText, `method ${m.key} lists formula and inputs`);
    assert.ok(m.inputs, `method ${m.key} returns its inputs`);
  }
  assert.deepEqual(r.methods.map((m) => m.key), ['spi', 'sv', 'slippage', 'es', 'pace', 'pert']);
});

test('flat progress gives no finish at that pace, and no history gives no trajectory', () => {
  const p = { startDate: '2025-01-01', milestones: [{ pct: 100, due: '2025-12-31' }] };
  const flat = T.paceFinish([{ period: '2025-03', value: 10 }, { period: '2025-04', value: 10 }, { period: '2025-05', value: 10 }], 3);
  assert.equal(flat.finish, null);
  assert.equal(T.finishRange(p, []).ok, false);
});
