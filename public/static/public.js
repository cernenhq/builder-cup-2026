// Public: a plain progress note per project. No verdict labels, no staff names, no accusations.
(async function () {
  const { esc, $, api, header } = window.PoP;
  await header({ subtitle: 'Public progress notes' });
  const main = $('#main');
  const id = location.pathname.slice(PoP.base.length).split('/')[2];
  if (!id) {
    const list = await api('/api/public/projects');
    main.innerHTML = `<div class="pub"><h1 class="section">Project progress</h1><p class="small">Notes from the Municipal Engineering Office, based on site photos the office has looked at.</p>${list
      .map((n) => `<div class="card section"><h2><a href="${esc(PoP.base)}/public/${esc(n.projectId)}">${esc(n.name)}</a></h2><div class="small">${esc(n.location)}</div><p>${n.percent ? `Reported ${esc(n.percent.value)}% complete as of ${esc(n.percent.asOf)}.` : 'No progress reported yet.'}</p></div>`)
      .join('')}</div>`;
    return;
  }
  const n = await api(`/api/public/projects/${encodeURIComponent(id)}`);
  main.innerHTML = `<div class="pub" data-testid="public-note"><h1 class="section">${esc(n.name)}</h1><div class="small">${esc(n.location)}${n.fictional ? ' · demo project, figures fictional' : ''}</div>
    <div class="card section">${n.hasPhoto ? `<img src="${esc(PoP.base)}/api/public/projects/${esc(n.projectId)}/photo" alt="Latest site photo the office has looked at"><p class="small">Site photo, ${esc(n.photoPeriod)}.</p>` : '<p class="small">No site photo yet.</p>'}
    <p class="big">${n.percent ? `${esc(n.percent.value)}% complete` : 'No progress reported yet'}</p>${n.percent ? `<p class="small">As reported by the ${esc(n.source)}, as of ${esc(n.percent.asOf)}.</p>` : ''}</div>
    <div class="card section"><h2>What the photos show</h2>${n.photosShow.length ? `<ul>${n.photosShow.map((s) => `<li>${esc(s.text)} <span class="small">(${esc(s.month)})</span></li>`).join('')}</ul>` : '<p>Nothing has been confirmed from photos yet.</p>'}
    <h2>Not visible in the photos, or not yet confirmed</h2>${n.notVisible.length ? `<ul>${n.notVisible.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '<p>None listed.</p>'}
    <p class="small">${esc(n.explainer)}</p></div>
    <p class="small"><a href="${esc(PoP.base)}/public">All projects</a></p></div>`;
})();
