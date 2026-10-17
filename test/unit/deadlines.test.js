const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/domain/deadlines');

test('DILG SubayBAYAN is due before the 25th: the 24th is on time, the 25th is late', () => {
  const due = D.dueDate('SUBAYBAYAN', '2026-05');
  assert.equal(due, '2026-05-24');
  assert.equal(D.obligationStatus(due, [{ submittedOn: '2026-05-24' }], '2026-06-01').status, 'on_time');
  const late = D.obligationStatus(due, [{ submittedOn: '2026-05-25' }], '2026-06-01');
  assert.equal(late.status, 'late');
  assert.equal(late.daysLate, 1);
  assert.equal(late.countsAsOnTime, false);
});

test('COA is due 5 working days after the month closes, skipping weekends', () => {
  // May 2026 closes on Sunday 31 May: Mon 1 to Fri 5 June.
  assert.equal(D.dueDate('COA', '2026-05'), '2026-06-05');
  // January 2026 closes on Saturday: Mon 2 Feb to Fri 6 Feb.
  assert.equal(D.dueDate('COA', '2026-01'), '2026-02-06');
});

test('working days skip Philippine holidays (Labor Day, Holy Week, Araw ng Kagitingan)', () => {
  // April 2026 closes Thursday 30 April; 1 May is a holiday: 4, 5, 6, 7, 8 May.
  assert.equal(D.dueDate('COA', '2026-04'), '2026-05-08');
  // Q1 2026 closes 31 March; 2 and 3 April (Holy Week) and 9 April are holidays: 1, 6, 7, 8, 10 April.
  assert.equal(D.dueDate('IAS', '2026-Q1'), '2026-04-10');
  assert.equal(D.dueDate('MPDO', '2026-Q1'), '2026-04-10');
  assert.equal(D.isWorkingDay('2026-06-12'), false);
  assert.equal(D.isWorkingDay('2026-06-13'), false);
  assert.equal(D.isWorkingDay('2026-06-15'), true);
});

test('year-end report is due on 15 December', () => {
  const due = D.dueDate('YEAR_END', '2026');
  assert.equal(due, '2026-12-15');
  assert.equal(D.obligationStatus(due, [{ submittedOn: '2026-12-15' }], '2026-12-20').status, 'on_time');
  assert.equal(D.obligationStatus(due, [{ submittedOn: '2026-12-16' }], '2026-12-20').status, 'late');
});

test('quarter and period keys', () => {
  assert.equal(D.quarterOf('2026-05'), '2026-Q2');
  assert.equal(D.periodKeyFor('IAS', '2026-05'), '2026-Q2');
  assert.equal(D.periodKeyFor('YEAR_END', '2026-05'), '2026');
  assert.equal(D.periodKeyFor('COA', '2026-05'), '2026-05');
});

test('not submitted: due soon, then overdue with a day count', () => {
  assert.equal(D.obligationStatus('2026-06-05', [], '2026-06-01').status, 'due_soon');
  assert.equal(D.obligationStatus('2026-06-30', [], '2026-06-01').status, 'upcoming');
  const o = D.obligationStatus('2026-05-24', [], '2026-06-01');
  assert.equal(o.status, 'overdue');
  assert.equal(o.daysOverdue, 8);
});

test('late reports are flagged and not counted as on time', () => {
  const s = [
    D.obligationStatus('2026-05-24', [{ submittedOn: '2026-05-20' }], '2026-06-01'),
    D.obligationStatus('2026-05-08', [{ submittedOn: '2026-05-12' }], '2026-06-01'),
    D.obligationStatus('2026-05-24', [], '2026-06-01'),
    D.obligationStatus('2026-06-05', [], '2026-06-01')
  ];
  const c = D.compliance(s);
  assert.equal(c.due, 3); // the one due on 5 June is not due yet
  assert.equal(c.onTime, 1);
  assert.equal(c.lateFlagged, 1);
  assert.equal(c.overdue, 1);
  assert.equal(Math.round(c.onTimeRate * 100), 33);
});

test('the earliest submission decides lateness, so re-logging cannot turn late into on time', () => {
  const s = D.obligationStatus('2026-05-24', [{ submittedOn: '2026-05-30' }, { submittedOn: '2026-05-31' }], '2026-06-01');
  assert.equal(s.status, 'late');
  assert.equal(s.submittedOn, '2026-05-30');
});

test('obligations for a project cover monthly, quarterly and year-end reports up to the horizon', () => {
  const obl = D.obligationsFor({ firstPeriod: '2025-11' }, '2026-01-10', 10);
  const keys = obl.map((o) => `${o.kind}|${o.periodKey}`);
  assert.ok(keys.includes('SUBAYBAYAN|2025-11'));
  assert.ok(keys.includes('COA|2025-12'));
  assert.ok(keys.includes('YEAR_END|2025'));
  assert.ok(keys.includes('IAS|2025-Q4'));
  assert.ok(!keys.includes('SUBAYBAYAN|2026-01'), 'January DILG is due 24 Jan, past the 10-day horizon');
});

test('week range runs Monday to Sunday', () => {
  assert.deepEqual(D.weekRange('2026-06-03'), { start: '2026-06-01', end: '2026-06-07' });
  assert.deepEqual(D.weekRange('2026-06-07'), { start: '2026-06-01', end: '2026-06-07' });
});
