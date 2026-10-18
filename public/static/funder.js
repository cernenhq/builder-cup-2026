// Owner and lender view: read only. Where the money's progress stands, from what a person decided.
(async function () {
  const { esc, $, api, header, fmtDate, stage } = window.PoP;
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
      ${p.photosByMonth && p.photosByMonth.length ? `<div class="section" data-testid="funder-compare"><h3>Compare months on the site photo</h3><div id="cmp-stage-${esc(p.id)}">${stage(PoP.url('/api/photos/' + p.photosByMonth[0].photoId), [])}</div><div id="cmp-pick-${esc(p.id)}" class="section"></div><p class="mini">${esc(p.photosByMonth[0].label)} photo. Lens, Swipe and Change map show another month in the same spot. The demo frames come from one fixed camera, aligned to the same view.</p></div>` : ''}
      ${c ? `<div class="section card" data-testid="owner-report"><h3>Owner report, ${esc(c.label)}</h3><p class="small">Drafted with Gemini from what a person in the office decided, nothing else. Edit it, print it or save it as PDF. It decides nothing about payment and is not sent anywhere.</p><p><button type="button" class="btn primary" data-draft="${esc(p.id)}|${esc(c.period)}" data-testid="owner-draft">Draft the owner report with Gemini</button> <button type="button" class="btn" data-print data-testid="owner-print">Print or save as PDF</button> <span class="small" id="dmsg-${esc(p.id)}"></span></p><textarea id="dtext-${esc(p.id)}" rows="7" style="width:100%" aria-label="Owner report draft" placeholder="The draft appears here."></textarea></div>` : ''}
      ${p.hasOverlay ? '<div data-testid="funder-overlay" id="ov-' + esc(p.id) + '"></div>' : ''}
    </div>`;
  };
  main.innerHTML = `<section class="section"><h1>Where the work stands</h1><p class="small">${esc(o.note)} "Can't tell" means the camera cannot see it, not that the work is missing.</p></section>${o.projects.map(card).join('')}`;
  for (const p of o.projects.filter((x) => x.photosByMonth && x.photosByMonth.length > 1 && window.PoPLens)) {
    const st = document.querySelector(`#cmp-stage-${p.id} .stage`);
    const months = p.photosByMonth.slice(1).map((m) => ({ period: m.period, label: m.label, url: PoP.url('/api/photos/' + m.photoId), status: 'aligned', note: 'Prepared demo frames, aligned to the same view.' }));
    window.PoPLens.attach({ stage: st, picker: document.getElementById(`cmp-pick-${p.id}`), currentLabel: p.photosByMonth[0].label, months, selected: months[months.length - 1].period });
  }
  main.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-print]')) return window.print();
    const b = ev.target.closest('[data-draft]');
    if (!b) return;
    const [pid, period] = b.dataset.draft.split('|');
    const msg = document.getElementById(`dmsg-${pid}`);
    b.disabled = true;
    msg.textContent = 'Drafting...';
    try {
      const r = await api(`/api/projects/${encodeURIComponent(pid)}/periods/${encodeURIComponent(period)}/draft-note`, { method: 'POST', body: { audience: 'owner' } });
      document.getElementById(`dtext-${pid}`).value = r.text;
      msg.textContent = r.saved ? `Saved Gemini draft, ${r.model}.` : `Drafted now with ${r.model}.`;
    } catch (e) {
      msg.textContent = e.message;
    } finally {
      b.disabled = false;
    }
  });
  for (const p of o.projects.filter((x) => x.hasOverlay)) {
    const slot = document.getElementById(`ov-${p.id}`);
    if (slot && window.PoPOwner) window.PoPOwner.mount(slot, p.id).catch((e) => (slot.innerHTML = `<p class="small">The plan view could not load: ${esc(e.message)}</p>`));
  }
})();
