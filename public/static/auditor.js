// Auditor (COA, IAS, DILG): read-only decision log and submission log with timestamps and names.
(async function () {
  const { esc, $, api, chip, statusChip, fmtDate, fmtTime, header } = window.PoP;
  const h = await header({ signedIn: true, subtitle: 'Auditor, read only' });
  if (!h) return;
  const main = $('#main');
  const projects = await api('/api/audit/projects');
  let pid = projects[0] && projects[0].id;

  async function render() {
    const L = await api(`/api/audit/projects/${pid}/log`);
    main.innerHTML = `<div class="card section"><div class="row"><label>Project <select id="psel" data-testid="audit-project">${projects
      .map((p) => `<option value="${esc(p.id)}" ${p.id === pid ? 'selected' : ''}>${esc(p.name)} (${esc(p.contractId)})</option>`)
      .join('')}</select></label><span class="spacer"></span><a class="btn" href="${esc(PoP.base)}/api/audit/projects/${esc(pid)}/log.csv" data-testid="audit-csv">Download CSV</a></div>
      <p class="small">Read only. Every line decision shows both readers, the AI default, what the reviewer decided, the reason, who and when. Timestamps are when the entry was made.</p></div>
      <div class="card section" data-testid="decision-log"><h2>Decision log</h2><div class="tablewrap"><table><tr><th>When</th><th>Period</th><th>Line or check</th><th>Readers</th><th>Default</th><th>Decision</th><th>Reason</th><th>Who</th></tr>${L.decisions
        .map((d) =>
          d.kind === 'line'
            ? `<tr><td>${esc(fmtTime(d.at))}</td><td>${esc(d.period)}</td><td>${esc(d.lineLabel)}</td><td>${chip(d.readerA || 'no_answer')} ${chip(d.readerB || 'no_answer')}${d.aiMode === 'mock' ? ' <span class="chip demo">demo</span>' : ''}</td><td>${chip(d.aiDefault)}</td><td>${chip(d.decision)}${d.overrode ? ' <b>override</b>' : ''}</td><td>${esc(d.reason)}</td><td>${esc(d.by.name)}</td></tr>`
            : `<tr><td>${esc(fmtTime(d.at))}</td><td>${esc(d.period)}</td><td>Photo check: ${esc(d.checkKey)}</td><td></td><td></td><td>explained</td><td>${esc(d.reason)}</td><td>${esc(d.by.name)}</td></tr>`
        )
        .join('')}</table></div></div>
      <div class="card section" data-testid="submission-log"><h2>Report submission log</h2><div class="tablewrap"><table><tr><th>Report</th><th>Period</th><th>Due</th><th>Submitted</th><th>To</th><th>Status</th><th>Logged by</th><th>Logged at</th></tr>${L.transmittals
        .map((t) => `<tr><td>${esc(t.reportName)}</td><td>${esc(t.periodKey)}</td><td>${esc(fmtDate(t.due))}</td><td>${esc(fmtDate(t.submittedOn))}</td><td>${esc(t.to)}</td><td>${statusChip(t.late ? 'late' : 'on_time')}</td><td>${esc(t.loggedBy.name)}</td><td>${esc(fmtTime(t.loggedAt))}</td></tr>`)
        .join('')}</table></div></div>
      <div class="grid cols-2 section">
      <div class="card" data-testid="contractor-log"><h2>Contractor submissions</h2><table><tr><th>Received</th><th>Period</th><th>Lines</th><th>Photos</th></tr>${L.submissions.map((s) => `<tr><td>${esc(fmtTime(s.receivedAt))}</td><td>${esc(s.period)}</td><td>${esc(s.claims.length)}</td><td>${esc(s.photoIds.length)}</td></tr>`).join('')}</table></div>
      <div class="card" data-testid="percent-log"><h2>Percent complete entries</h2><table><tr><th>Period</th><th>Value</th><th>Entered by</th><th>When</th></tr>${L.percentEntries.map((e) => `<tr><td>${esc(e.period)}</td><td>${esc(e.value)}%</td><td>${esc(e.enteredByName)}</td><td>${esc(fmtTime(e.enteredAt))}</td></tr>`).join('')}</table></div>
      <div class="card" data-testid="check-log"><h2>Check runs</h2><table><tr><th>Period</th><th>Run</th><th>By</th><th>Readers</th></tr>${L.checkRuns.map((c) => `<tr><td>${esc(c.period)}</td><td>${esc(fmtTime(c.runAt))}</td><td>${esc(c.runBy.name)}</td><td>${esc(c.aiMode === 'mock' ? 'demo, not a model result' : `${c.models.A}, ${c.models.B}`)}</td></tr>`).join('')}</table></div>
      <div class="card" data-testid="monitoring-log"><h2>Monitoring work</h2><table><tr><th>Date</th><th>What</th><th>By</th></tr>${L.monitoring.map((m) => `<tr><td>${esc(fmtDate(m.date))}</td><td>${esc(m.kind)}</td><td>${esc(m.by.name)}</td></tr>`).join('')}</table></div>
      </div>`;
    $('#psel').onchange = (e) => {
      pid = e.target.value;
      render();
    };
  }
  render();
})();
