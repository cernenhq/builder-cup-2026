// Mayor: one screen. Only escalated items, in plain words. The gauge stays dark until something is.
(async function () {
  const { esc, $, api, header } = window.PoP;
  const h = await header({ signedIn: true, subtitle: 'Mayor' });
  if (!h) return;
  const main = $('#main');
  const e = await api('/api/mayor/escalations');
  const n = e.escalated;
  // Needle angle: 0 items points left (dark), 5 or more points right.
  const frac = Math.min(1, n / 5);
  const ang = Math.PI * (1 - frac);
  const nx = 120 + 88 * Math.cos(ang);
  const ny = 120 - 88 * Math.sin(ang);
  const arc = (a0, a1, col) => {
    const p = (a) => [120 + 100 * Math.cos(Math.PI * (1 - a)), 120 - 100 * Math.sin(Math.PI * (1 - a))];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return `<path d="M${x0} ${y0} A100 100 0 0 1 ${x1} ${y1}" fill="none" stroke="${col}" stroke-width="18"/>`;
  };
  const lit = (from) => n > 0 && frac >= from;
  const svg = `<svg viewBox="0 0 240 140" role="img" aria-label="${n} escalated item(s)" data-testid="gauge" data-state="${esc(e.gauge)}">
    ${arc(0, 0.33, '#3b3933')}${arc(0.34, 0.66, lit(0.01) ? '#d6a21e' : '#3b3933')}${arc(0.67, 1, lit(0.5) ? '#c0452b' : '#3b3933')}
    <line x1="120" y1="120" x2="${nx}" y2="${ny}" stroke="${n ? '#1c1b18' : '#77736a'}" stroke-width="4" stroke-linecap="round"/><circle cx="120" cy="120" r="7" fill="#1c1b18"/></svg>`;
  main.innerHTML = `<section class="section"><div class="card gauge">${svg}<div><div class="big" data-testid="escalated-count">${n === 0 ? 'Nothing escalated' : `${n} item${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} your attention`}</div>
    <p class="small">This screen shows only what has gone past the office's own follow-up: reports well past their deadline, milestones long overdue, and projects where the municipal engineer has confirmed that photos do not show what was claimed on several line items. Everything else is handled by the office first.</p></div></div></section>
    <section class="section" data-testid="escalations">${e.items
      .map((i) => `<div class="esc" data-kind="${esc(i.kind)}">${esc(i.plain)}<div class="who">Person in charge: ${esc(i.personInCharge)}</div></div>`)
      .join('') || '<p class="small">Nothing to act on today.</p>'}</section>`;
})();
