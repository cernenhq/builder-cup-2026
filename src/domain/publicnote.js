// The public progress note. Built only from what a person in the office has confirmed.
// It never shows verdict labels, never names staff, and never accuses anyone.
// - "What the photos show": for each line item, the latest description the reviewer confirmed the
//   photos show (the plain question text), with its month.
// - "Not visible or not yet confirmed": line items whose latest confirmed state is anything else,
//   lines not yet looked at, and hidden work. One neutral heading for all of them, on purpose.
const { PHRASES } = require('./wording');
const { monthLabel, dateLabel } = require('./escalation');

function publicNote({ project, periods, effective, latest }) {
  const lines = project.lines || [];
  const checked = periods.filter((p) => p.check).sort((a, b) => a.period.localeCompare(b.period));
  const lastShown = {};
  const lastState = {};
  for (const per of checked) {
    for (const l of per.check.lines) {
      const d = effective.get(`${per.period}|${l.lineKey}`);
      if (!d) {
        lastState[l.lineKey] = 'unconfirmed';
        continue;
      }
      lastState[l.lineKey] = d.decision;
      if (d.decision === 'supported') lastShown[l.lineKey] = { text: l.question, period: per.period };
    }
  }
  const shows = [];
  const notVisible = [];
  for (const line of lines) {
    const label = line.publicLabel || line.label;
    if (line.hidden) {
      notVisible.push(label);
      continue;
    }
    if (lastShown[line.key]) shows.push({ text: lastShown[line.key].text, month: monthLabel(lastShown[line.key].period), period: lastShown[line.key].period });
    if (lastState[line.key] && lastState[line.key] !== 'supported') notVisible.push(label);
  }
  shows.sort((a, b) => b.period.localeCompare(a.period));
  const withPhotos = checked.filter((p) => p.check.photoIds && p.check.photoIds.length && p.check.lines.some((l) => effective.has(`${p.period}|${l.lineKey}`)));
  const photoPer = withPhotos[withPhotos.length - 1];
  return {
    projectId: project.id,
    name: project.name,
    location: project.location,
    fictional: !!project.fictional,
    percent: latest ? { value: latest.value, asOf: dateLabel(latest.asOf) } : null,
    photoPeriod: photoPer ? monthLabel(photoPer.period) : null,
    hasPhoto: !!photoPer,
    photosShow: shows.map(({ text, month }) => ({ text, month })),
    notVisible,
    explainer: PHRASES.publicDisclaimer,
    source: 'Municipal Engineering Office'
  };
}

module.exports = { publicNote };
