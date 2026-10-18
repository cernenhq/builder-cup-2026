// Owner and lender view: read only. Where the money's progress stands, from what a person decided.
(async function () {
  const { esc, $, api, header, fmtDate } = window.PoP;
  const h = await header({ signedIn: true, subtitle: 'Owner and lender view' });
  if (!h) return;
  const main = $('#main');
  const o = await api('/api/funder/overview');
  const pct = (v) => (v === null || v === undefined ? 'n/a' : `${esc(v)}%`);
  const card = (p) => {
    const c = p.latestChecked;
    const slip = p.slippage ? `planned ${esc(p.slippage.planned)}% for that date, so ${p.slippage.points > 0 ? '+' : ''}${esc(p.slippage.points)} points` : '';
    return `<div class="card section" data-testid="funder-project" data-pid="${esc(p.id)}">
      <h2>${esc(p.name)}</h2><div class="small">${esc(p.contractor)} · ${esc(p.location)}${p.fictional ? ' · demo, figures fictional' : ''}</div>
      <div class="row section"><div><div class="small">Office percent complete</div><div class="big">${p.percent ? pct(p.percent.value) : 'none yet'}</div><div class="small">${p.percent ? `as of ${esc(fmtDate(p.percent.asOf))}` : ''}${slip ? ` · ${slip}` : ''}</div></div></div>
      ${c ? `<p data-testid="funder-counts"><b>${esc(c.label)}, checked against site photos:</b> ${c.counts.supported} supported, ${c.counts.contradicted} contradicted, ${c.counts.not_assessable} can't tell${c.counts.waiting ? `, ${c.counts.waiting} waiting for a person` : ''}${c.stale ? ' <span class="chip lvl-1">photos or claims changed since the check</span>' : ''}.</p>` : '<p class="small">No month checked against photos yet.</p>'}
      ${p.overdueMilestones.length || p.overdueReports.length ? `<ul class="small">${p.overdueMilestones.map((m) => `<li>${esc(m.pct)}% milestone was planned for ${esc(fmtDate(m.due))}</li>`).join('')}${p.overdueReports.map((r) => `<li>Overdue report: ${esc(r)}</li>`).join('')}</ul>` : ''}
      <p class="small"><a href="${esc(window.PoP.base)}/public/${esc(p.id)}">Public progress note</a></p>
      ${p.hasOverlay ? '<div data-testid="funder-overlay" id="ov-' + esc(p.id) + '"></div>' : ''}
    </div>`;
  };
  main.innerHTML = `<section class="section"><h1>Where the work stands</h1><p class="small">${esc(o.note)} "Can't tell" means the camera cannot see it, not that the work is missing.</p></section>${o.projects.map(card).join('')}`;
  for (const p of o.projects.filter((x) => x.hasOverlay)) {
    const slot = document.getElementById(`ov-${p.id}`);
    if (slot && window.PoPOwner) window.PoPOwner.mount(slot, p.id).catch((e) => (slot.innerHTML = `<p class="small">The plan view could not load: ${esc(e.message)}</p>`));
  }
})();
