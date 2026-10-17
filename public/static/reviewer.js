// Reviewer / municipal engineer (office head): Monday view, line-by-line decisions with reasons,
// history of overrides.
(async function () {
  const { esc, $, $$, api, chip, statusChip, fmtDate, fmtTime, setMsg, header, stage, findings } = window.PoP;
  const h = await header({ signedIn: true, subtitle: 'Reviewer' });
  if (!h) return;
  const { meta } = h;
  const main = $('#main');
  const S = { tab: new URLSearchParams(location.search).get('tab') || 'monday', sel: null, per: null, choice: {} };

  main.innerHTML = `<div class="tabs" data-testid="tabs"><button data-tab="monday">Monday view</button><button data-tab="review">Review lines</button><button data-tab="overrides">Override history</button></div><div id="body"></div>`;
  const body = $('#body');
  $$('[data-tab]').forEach((b) => (b.onclick = () => go(b.dataset.tab)));

  async function go(tab) {
    S.tab = tab;
    $$('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'monday') return monday();
    if (tab === 'review') return review();
    return overrides();
  }

  async function monday() {
    const m = await api('/api/review/monday');
    const lvl = (i) => `<span class="chip lvl-${i.level}">${i.level === 2 ? 'escalated to mayor' : 'office'}</span>`;
    body.innerHTML = `<h1 class="section">Week of ${esc(fmtDate(m.week.start))}</h1>
      <div id="owner-slot"><div class="card section" data-testid="owner-view-loading"><p class="small">Loading the plan over this month's photo...</p></div></div>
      <div class="grid cols-wide section">
      <div class="card" data-testid="lagging"><h2>Projects by slippage</h2><div class="tablewrap"><table><tr><th>Project</th><th>In charge</th><th>Office %</th><th>Planned</th><th>Slippage</th></tr>${m.lagging
        .map((p) => `<tr data-lagging="${p.lagging ? 'yes' : 'no'}"><td>${esc(p.name)}</td><td>${esc(p.inChargeName)}</td><td>${esc(p.slippage.actual)}%</td><td>${esc(p.slippage.planned)}%</td><td><span class="chip ${p.lagging ? 'lvl-1' : 's-on_time'}">${p.slippage.points > 0 ? '+' : ''}${esc(p.slippage.points)} pts${p.lagging ? ', lagging' : ''}</span></td></tr>`)
        .join('')}</table></div><p class="mini">Slippage is the office's latest percent minus the planned percent at the same date. Lagging means 5 or more points behind (a setting).</p></div>
      <div class="card" data-testid="reports-week"><h2>Reports due this week, overdue or late</h2><div class="tablewrap"><table><tr><th>Project</th><th>Report</th><th>Due</th><th>Status</th><th>In charge</th></tr>${m.reports
        .map((r) => `<tr><td>${esc(r.projectName)}</td><td>${esc(r.label)}</td><td>${esc(fmtDate(r.due))}</td><td>${statusChip(r.status)}${r.daysOverdue ? ` <span class="mini">${esc(r.daysOverdue)} days</span>` : ''}${r.daysLate ? ` <span class="mini">${esc(r.daysLate)} days late</span>` : ''}</td><td>${esc(r.inCharge)}</td></tr>`)
        .join('')}</table></div></div>
      <div class="card" data-testid="queue"><h2>Waiting for review</h2>${m.queue.length ? m.queue.map((q) => `<div class="row" style="margin-bottom:6px"><span>${esc(q.projectName)}: <b>${esc(q.pending)}</b> line(s)</span><span class="mini">${esc(q.inCharge)}</span></div>`).join('') : '<p class="small">Nothing waiting.</p>'}<button class="primary" data-goreview>Open review</button></div>
      <div class="card" data-testid="incharge"><h2>Who is in charge</h2><table>${m.inCharge.map((x) => `<tr><td>${esc(x.projectName)}</td><td>${esc(x.inCharge)}</td></tr>`).join('')}</table></div>
      <div class="card" data-testid="office-items"><h2>Gauge items</h2><p class="mini">Yellow items stay with the office. Red ones also show on the mayor's screen.</p>${m.office
        .sort((a, b) => b.level - a.level)
        .map((i) => `<div class="find"><span class="dot ${i.level === 2 ? 'flag' : 'info'}"></span><div>${lvl(i)} ${esc(i.plain)}</div></div>`)
        .join('')}</div>
      <div class="card" data-testid="credit"><h2>Monitoring work (credit)</h2><table><tr><th>Person</th><th>Entries</th><th>Hours</th><th>For the contractor</th></tr>${m.credit.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.entries)}</td><td>${esc(c.hours)}</td><td>${esc(c.onBehalf)}</td></tr>`).join('')}</table></div>
      </div>`;
    const gr = $('[data-goreview]');
    if (gr) gr.onclick = () => go('review');
    // The plan laid over the latest checked photo of the demo project, and the finish range.
    // Loaded after the lists so they never wait on it.
    const slot = $('#owner-slot');
    if (slot && window.PoPOwner) window.PoPOwner.mount(slot, 'P-001').catch((e) => (slot.innerHTML = `<div class="card section"><p class="small">The owner view could not load: ${esc(e.message)}</p></div>`));
    else if (slot) slot.innerHTML = '';
  }

  async function review() {
    const q = await api('/api/review/queue');
    if (!S.sel && q.length) S.sel = `${q[0].projectId}|${q[0].period}`;
    body.innerHTML = `<div class="card section"><div class="row"><label>Project and period <select id="qsel" data-testid="queue-select">${q
      .map((x) => `<option value="${esc(x.projectId)}|${esc(x.period)}" ${S.sel === `${x.projectId}|${x.period}` ? 'selected' : ''}>${esc(x.projectName)}, ${esc(x.label)} (${esc(x.pending)} waiting)</option>`)
      .join('')}${S.sel && !q.some((x) => `${x.projectId}|${x.period}` === S.sel) ? `<option selected value="${esc(S.sel)}">${esc(S.sel.replace('|', ', '))} (done)</option>` : ''}</select></label>
      <span class="small">Confirm or override every line. A reason is required each time; it goes into the decision log with your name.</span></div></div><div id="rv"></div>`;
    const sel = $('#qsel');
    if (sel) sel.onchange = () => {
      S.sel = sel.value;
      S.choice = {};
      loadReview();
    };
    if (S.sel) await loadReview();
    else $('#rv').innerHTML = '<p class="small section">Nothing is waiting for review.</p>';
  }

  async function loadReview() {
    const [pid, period] = S.sel.split('|');
    S.per = await api(`/api/projects/${pid}/periods/${period}`);
    const c = S.per.check;
    if (!c) {
      $('#rv').innerHTML = '<p class="small">Not checked yet.</p>';
      return;
    }
    const mock = c.aiMode === 'mock';
    const photo = S.per.photos.find((p) => p.id === c.photoIds[0]);
    const boxes = c.lines.map((l) => {
      const r = (l.readers.A && l.readers.A.box ? l.readers.A : null) || (l.readers.B && l.readers.B.box ? l.readers.B : null);
      return r && (r.photoIndex || 0) === 0 ? { id: l.lineKey, box: r.box, verdict: l.aiDefault, label: l.label } : null;
    }).filter(Boolean);
    const explained = new Map((S.per.flagNotes || []).map((n) => [`${n.photoId}|${n.checkKey}`, n]));
    $('#rv').innerHTML = `<div class="grid cols-2 section"><div><div class="card">${photo ? stage(photo.url, boxes) : '<p class="small">No photo.</p>'}
      <p class="small">${mock ? `<span class="chip demo" data-testid="demo-badge">${esc(meta.phrases.mockReader)}</span>` : `Readers: ${esc(c.models.A)}, ${esc(c.models.B)}`} · checked ${esc(fmtTime(c.runAt))} by ${esc(c.runBy.name)}</p></div>
      <div class="card section"><h3>Photo checks (no AI)</h3>${c.photoChecks
        .map((pc) => `<div class="small"><b>${esc(pc.fileName)}</b></div>${findings(pc.findings)}${pc.findings
          .filter((f) => f.level === 'flag')
          .map((f) => {
            const n = explained.get(`${pc.photoId}|${f.key}`);
            return n ? `<div class="mini">Explained by ${esc(n.by.name)}: ${esc(n.explanation)}</div>` : `<div class="row" style="margin:4px 0 8px"><input placeholder="Optional: explain this flag (for example, reference shot)" data-flag="${esc(pc.photoId)}|${esc(f.key)}" style="flex:1"><button data-saveflag="${esc(pc.photoId)}|${esc(f.key)}">Note</button></div>`;
          })
          .join('')}`)
        .join('')}</div></div>
      <div data-testid="review-lines">${c.lines.map((l) => lineCard(l, mock)).join('')}</div></div>`;
    $$('[data-pick]').forEach((b) => (b.onclick = () => {
      const [k, v] = b.dataset.pick.split('|');
      S.choice[k] = v;
      $$(`[data-pick^="${k}|"]`).forEach((x) => x.classList.toggle('on', x === b));
    }));
    $$('[data-save]').forEach((b) => (b.onclick = async () => {
      const k = b.dataset.save;
      const reason = $(`[data-reason="${k}"]`).value;
      const msg = $(`[data-msg="${k}"]`);
      if (!S.choice[k]) return setMsg(msg, 'Pick supported, contradicted or can\'t tell.', 'err');
      try {
        await api(`/api/projects/${pid}/periods/${period}/decisions`, { method: 'POST', body: { lineKey: k, decision: S.choice[k], reason } });
        delete S.choice[k];
        await review();
      } catch (e) {
        setMsg(msg, e.message, 'err');
      }
    }));
    $$('[data-saveflag]').forEach((b) => (b.onclick = async () => {
      const [photoId, checkKey] = b.dataset.saveflag.split('|');
      const explanation = $(`[data-flag="${b.dataset.saveflag}"]`).value;
      try {
        await api(`/api/projects/${pid}/periods/${period}/flag-notes`, { method: 'POST', body: { photoId, checkKey, explanation } });
        await loadReview();
      } catch (e) {
        alert(e.message);
      }
    }));
  }

  function readerBox(name, r, mock) {
    if (!r) return `<div class="reader"><b>${name}</b> ${chip('no_answer')}</div>`;
    return `<div class="reader"><b>${name}</b> ${chip(r.verdict)}${mock ? ' <span class="chip demo">demo</span>' : ''}<div class="mini">${esc(r.reason)}</div></div>`;
  }
  function lineCard(l, mock) {
    const d = l.decision;
    const k = esc(l.lineKey);
    const opts = [['supported', 'Supported'], ['contradicted', 'Contradicted'], ['not_assessable', "Can't tell"]];
    return `<div class="line" data-line="${k}"><div class="row"><span class="lab">${esc(l.label)}</span><span class="spacer"></span><span class="mini">AI default</span> ${chip(l.aiDefault)}</div>
      <div class="mini">Claim: ${esc(l.statement)}</div><div class="q">Question: ${esc(l.question)}</div>
      <div class="readers">${readerBox('Reader A', l.readers.A, mock)}${readerBox('Reader B', l.readers.B, mock)}</div>
      ${l.aiDefault === 'disagree' ? '<div class="mini" style="margin-top:6px"><b>The readers disagree.</b> There is no default; decide from the photo.</div>' : l.note ? `<div class="mini" style="margin-top:6px">${esc(l.note)}</div>` : ''}
      ${d ? `<div class="mini" style="margin-top:8px" data-testid="decided">Decided: ${chip(d.decision)} ${d.overrode ? '<b>override</b>' : 'confirmed'} · ${esc(d.reason)} · ${esc(d.by.name)}, ${esc(fmtTime(d.at))}</div>` : ''}
      <div class="decide">${opts.map(([v, lab]) => `<button data-pick="${k}|${v}" class="${S.choice[l.lineKey] === v ? 'on' : ''}">${lab}${l.aiDefault === v ? ' (default)' : ''}</button>`).join('')}
      <input placeholder="Reason (required)" data-reason="${k}"><button class="primary" data-save="${k}">${d ? 'Change decision' : 'Save decision'}</button></div><div class="msg" data-msg="${k}"></div></div>`;
  }

  async function overrides() {
    const rows = await api('/api/review/overrides');
    body.innerHTML = `<div class="card section" data-testid="overrides"><h2>Overrides and disagreements</h2><p class="small">Every decision where the reviewer did not take the AI default, or the readers disagreed. Earlier overrides are given to the readers as guidance on later checks.</p>
      <div class="tablewrap"><table><tr><th>When</th><th>Project</th><th>Period</th><th>Line</th><th>Readers</th><th>Default</th><th>Decision</th><th>Reason</th><th>By</th></tr>${rows
        .map((d) => `<tr><td>${esc(fmtTime(d.at))}</td><td>${esc(d.projectId)}</td><td>${esc(d.period)}</td><td>${esc(d.lineLabel)}</td><td>${chip(d.readerA || 'no_answer')} ${chip(d.readerB || 'no_answer')}</td><td>${chip(d.aiDefault)}</td><td>${chip(d.decision)}</td><td>${esc(d.reason)}</td><td>${esc(d.by.name)}</td></tr>`)
        .join('')}</table></div></div>`;
  }

  go(S.tab);
})();
