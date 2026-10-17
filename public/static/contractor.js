// Contractor: a simple page reached by the project's own link. Send the progress claim and photos,
// see that they arrived. No internal verdicts are ever sent to this page.
(async function () {
  const { esc, $, $$, api, fmtTime, monthLabel, setMsg, header } = window.PoP;
  await header({ subtitle: 'Contractor submission' });
  const main = $('#main');
  const token = decodeURIComponent(location.pathname.split('/').pop());
  let d;
  async function load() {
    d = await api(`/api/contractor/${encodeURIComponent(token)}`);
  }
  try {
    await load();
  } catch (e) {
    main.innerHTML = `<div class="card section"><h1>Link not valid</h1><p>${esc(e.message)}</p></div>`;
    return;
  }
  function render() {
    main.innerHTML = `<div class="card section"><h1 data-testid="contractor-project">${esc(d.project.name)}</h1><div class="small">${esc(d.project.contractId)} · ${esc(d.project.contractor)} · ${esc(d.project.location)}</div>
      <p>${esc(d.note)}</p><p class="small">Milestone reports are expected at ${esc(d.milestones.map((m) => `${m.pct}%`).join(', '))}.</p></div>
      <div class="card section"><h2>Progress claim (statement of work accomplished)</h2>
      <div class="form"><label>Reporting month <input type="month" id="cPeriod" value="${esc(d.suggestedPeriod)}" data-testid="c-period"></label></div>
      <div class="tablewrap section"><table><tr><th>Line item</th><th>Percent complete you claim</th></tr>${d.lines
        .map((l) => `<tr><td>${esc(l.label)}</td><td>${l.status ? `<select data-c="${esc(l.key)}"><option value="">not claimed</option><option value="0">${esc(l.status.none)}</option><option value="100">${esc(l.status.done)}</option></select>` : `<input type="number" min="0" max="100" step="0.1" style="width:90px" data-c="${esc(l.key)}"> %`}</td></tr>`)
        .join('')}</table></div>
      <div class="form section"><label>Milestone photos <input type="file" id="cPhotos" accept="image/*" multiple data-testid="c-photos"></label><label>Note to the office (optional) <textarea id="cNote" rows="2"></textarea></label>
      <button class="primary" id="cSend" data-testid="c-send">Send to the office</button></div><div class="msg" id="cMsg" data-testid="c-msg"></div></div>
      <div class="card section" data-testid="c-history"><h2>What you have sent</h2><div class="tablewrap"><table><tr><th>Month</th><th>Received</th><th>Lines</th><th>Photos</th><th>Status</th></tr>${d.submissions
        .map((s) => `<tr><td>${esc(s.periodLabel)}</td><td>${esc(fmtTime(s.receivedAt))}</td><td>${esc(s.lines)}</td><td>${esc(s.photos)}</td><td>${esc(s.status)}</td></tr>`)
        .join('') || '<tr><td colspan="5">Nothing yet.</td></tr>'}</table></div></div>`;
    $('#cSend').onclick = async () => {
      const claims = $$('[data-c]').filter((i) => i.value !== '').map((i) => ({ lineKey: i.dataset.c, claimedPct: Number(i.value) }));
      const fd = new FormData();
      fd.append('period', $('#cPeriod').value);
      fd.append('claims', JSON.stringify(claims));
      fd.append('note', $('#cNote').value);
      for (const f of $('#cPhotos').files) fd.append('photos', f);
      setMsg($('#cMsg'), 'Sending...');
      try {
        const r = await api(`/api/contractor/${encodeURIComponent(token)}/submissions`, { method: 'POST', form: fd });
        await load();
        render();
        setMsg($('#cMsg'), `Received for ${monthLabel($('#cPeriod').value)}: ${r.lines} line(s), ${r.photos} photo(s). ${r.status}`, 'ok');
      } catch (e) {
        setMsg($('#cMsg'), e.message, 'err');
      }
    };
  }
  render();
})();
