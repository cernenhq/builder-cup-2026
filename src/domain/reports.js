// Report drafts. The office enters the project's percent complete once per period; that one entry
// fills the COA, DILG SubayBAYAN, IAS and MPDO drafts, each with the fields that office needs.
// Drafts are downloads only. Nothing is sent anywhere by the tool.
const { PRODUCT_NAME, BRAND } = require('../brand');
const { KINDS, dueDate, periodKeyFor } = require('./deadlines');
const { plannedAt, projectStatusWord } = require('./progress');
const { monthLabel, periodKeyLabel, dateLabel } = require('./escalation');
const { PHRASES, VERDICT_LABEL } = require('./wording');
const { monthEnd } = require('./deadlines');

function photoRows(photos) {
  return photos.map((p) => ({
    file: p.fileName,
    captured: p.stampText ? `${p.stampText} (printed stamp)` : p.exif && p.exif.taken ? `${p.exif.taken.replace('T', ' ')} (file date)` : 'no capture date',
    gps: p.exif && p.exif.gps ? `${p.exif.gps.lat.toFixed(5)}, ${p.exif.gps.lon.toFixed(5)}` : 'no GPS in file'
  }));
}

function lineSummary(period, effective) {
  const lines = (period.check && period.check.lines) || [];
  const counts = { supported: 0, contradicted: 0, not_assessable: 0, pending: 0 };
  for (const l of lines) {
    const d = effective.get(`${period.period}|${l.lineKey}`);
    if (d) counts[d.decision]++;
    else counts.pending++;
  }
  return { total: lines.length, ...counts };
}

function narrativeFor(project, period, pct, planned, visible, notVisible, visits) {
  const slip = Math.round((pct - planned) * 10) / 10;
  const slipText = slip === 0 ? 'on plan' : slip > 0 ? `${slip} points ahead of plan` : `${Math.abs(slip)} points behind plan`;
  const parts = [
    `As of ${dateLabel(monthEnd(period.period))}, ${project.name} (${project.location}) is ${pct}% complete against a planned ${planned}%, ${slipText}.`,
    visible.length ? `The latest photos show: ${visible.join('; ')}.` : 'No line items have been confirmed from photos for this period.',
    notVisible.length ? `Not visible or not yet confirmed from photos: ${notVisible.join('; ')}. This does not mean the work was not done.` : '',
    `The office logged ${visits} monitoring ${visits === 1 ? 'activity' : 'activities'} for this project in ${monthLabel(period.period)}.`
  ];
  return parts.filter(Boolean).join(' ');
}

// Build all four period drafts from one stored percent entry.
function buildDrafts({ project, period, photos, effective, monitoring, inChargeName, today }) {
  const pc = period.percentComplete;
  if (!pc || typeof pc.value !== 'number') return null;
  const pct = pc.value;
  const asOf = monthEnd(period.period) < today ? monthEnd(period.period) : today;
  const planned = plannedAt(project, asOf);
  const slip = Math.round((pct - planned) * 10) / 10;
  const linesByKey = Object.fromEntries((project.lines || []).map((l) => [l.key, l]));
  const visible = [];
  const notVisible = [];
  for (const l of (period.check && period.check.lines) || []) {
    const d = effective.get(`${period.period}|${l.lineKey}`);
    const label = (linesByKey[l.lineKey] || {}).label || l.lineKey;
    if (d && d.decision === 'supported') visible.push(label);
    else if (d) notVisible.push(label);
  }
  const visits = monitoring.filter((m) => (m.date || '').slice(0, 7) === period.period).length;
  const prows = photoRows(photos);
  const sum = lineSummary(period, effective);
  const narrative = period.narrativeOverride || narrativeFor(project, period, pct, planned, visible, notVisible, visits);
  const common = [
    ['Project', project.name],
    ['Project ID', project.id],
    ['Contract ID', project.contractId],
    ['Location', project.location],
    ['Contractor', project.contractor],
    ['Person in charge (engineering office)', inChargeName],
    ['Reporting period', monthLabel(period.period)],
    ['Percent complete (entered once by the office)', `${pct}%`],
    ['Entered by', `${pc.enteredByName} on ${pc.enteredAt.slice(0, 10)}`]
  ];
  const mk = (kind, fields, extra = {}) => {
    const key = periodKeyFor(kind, period.period);
    return { kind, name: KINDS[kind].name, agency: KINDS[kind].agency, periodKey: key, periodLabel: periodKeyLabel(key), due: dueDate(kind, key), percent: pct, fields, photos: prows, ...extra };
  };
  return {
    percent: pct,
    fictional: !!project.fictional,
    drafts: [
      mk('COA', [
        ...common,
        ['Contract amount (fictional)', `PHP ${project.contractAmount.toLocaleString('en-PH')}`],
        ['Value of work accomplished at this percent (fictional)', `PHP ${Math.round((project.contractAmount * pct) / 100).toLocaleString('en-PH')}`],
        ['Geotagged photos on file this period', `${prows.filter((r) => r.gps !== 'no GPS in file').length} of ${prows.length}`],
        ['Line items checked against photos by the office', `${sum.total - sum.pending} of ${sum.total}`]
      ]),
      mk('SUBAYBAYAN', [
        ...common,
        ['Project status', period.statusOverride || projectStatusWord(pct)],
        ['Physical accomplishment', `${pct}%`],
        ['Date of update', today],
        ['Photos at this milestone', `${prows.length} photo(s) listed below, ${prows.filter((r) => r.gps !== 'no GPS in file').length} with GPS in the file`],
        ['Remarks', prows.length ? 'Photos attached as listed.' : 'No new photos this period.']
      ]),
      mk('IAS', [
        ...common,
        ['Planned percent at period end', `${planned}%`],
        ['Slippage (points)', `${slip > 0 ? '+' : ''}${slip}`],
        ['Line items reviewed: photos show the claim', String(sum.supported)],
        ["Line items reviewed: photos do not show the claim", String(sum.contradicted)],
        ["Line items reviewed: can't tell from photos", String(sum.not_assessable)],
        ['Line items not yet reviewed', String(sum.pending)]
      ]),
      mk('MPDO', [...common, ['Planned percent at period end', `${planned}%`], ['Slippage (points)', `${slip > 0 ? '+' : ''}${slip}`]], { narrative })
    ]
  };
}

function header(d) {
  return `${PRODUCT_NAME} (${BRAND}) | ${d.name} | ${d.periodLabel}`;
}
function toText(d, fictional) {
  const lines = [header(d), PHRASES.draftNotSent, `Due: ${dateLabel(d.due)} (${d.agency})`, ''];
  for (const [k, v] of d.fields) lines.push(`${k}: ${v}`);
  if (d.narrative) lines.push('', 'Narrative:', d.narrative);
  lines.push('', 'Photos:');
  if (!d.photos.length) lines.push('  none this period');
  for (const p of d.photos) lines.push(`  ${p.file} | ${p.captured} | ${p.gps}`);
  lines.push('', PHRASES.personDecides);
  if (fictional) lines.push('Demo data: project, progress claim and amounts are fictional.');
  return lines.join('\n') + '\n';
}
// Cells that a spreadsheet would read as a formula (=, +, -, @, tab, carriage return) get a leading
// apostrophe, so text typed into the app cannot run as a formula when the CSV is opened.
function csvSafe(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
function csvCell(v) {
  const s = csvSafe(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(d, fictional) {
  const rows = [['field', 'value'], ['report', d.name], ['period', d.periodLabel], ['due', d.due], ['status', 'DRAFT, not sent'], ...d.fields];
  if (d.narrative) rows.push(['narrative', d.narrative]);
  d.photos.forEach((p, i) => rows.push([`photo_${i + 1}`, `${p.file} | ${p.captured} | ${p.gps}`]));
  if (fictional) rows.push(['note', 'Demo data: fictional']);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function toHtml(d, fictional) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(d.name)} draft</title>
<style>body{font:15px/1.5 Georgia,serif;color:#1d1c1a;background:#fff;max-width:780px;margin:24px auto;padding:0 16px}h1{font-size:22px;margin:0 0 4px}
.draft{border:2px dashed #b4462e;color:#b4462e;padding:6px 10px;display:inline-block;margin:8px 0;font:600 13px system-ui,sans-serif}
table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}th{width:42%;font-weight:600}
.note{color:#555;font:13px system-ui,sans-serif}@media print{button{display:none}}</style></head><body>
<button onclick="print()">Print</button>
<h1>${esc(d.name)}: ${esc(d.periodLabel)}</h1><div class="note">${esc(PRODUCT_NAME)} (${esc(BRAND)}) &middot; due ${esc(dateLabel(d.due))} to ${esc(d.agency)}</div>
<div class="draft">${esc(PHRASES.draftNotSent)}</div>
<table>${d.fields.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>
${d.narrative ? `<h2>Narrative</h2><p>${esc(d.narrative)}</p>` : ''}
<h2>Photos</h2>${d.photos.length ? `<table><tr><th>File</th><td><b>Captured</b></td><td><b>Location</b></td></tr>${d.photos.map((p) => `<tr><th>${esc(p.file)}</th><td>${esc(p.captured)}</td><td>${esc(p.gps)}</td></tr>`).join('')}</table>` : '<p>None this period.</p>'}
<p class="note">${esc(PHRASES.personDecides)} ${esc(PHRASES.metadataMismatch)}</p>
${fictional ? '<p class="note">Demo data: project, progress claim and amounts are fictional.</p>' : ''}
</body></html>`;
}

module.exports = {
  csvCell,
  csvSafe,
  buildDrafts,
  toText,
  toCsv,
  toHtml,
  VERDICT_LABEL
};
