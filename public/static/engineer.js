// Engineer / person in charge: photos and progress claim in, check, percent complete once,
// four report drafts out, submission log and monitoring credit.
(async function () {
  const { esc, $, $$, api, chip, statusChip, fmtDate, fmtTime, monthLabel, setMsg, header, stage, findings } = window.PoP;
  const h = await header({ signedIn: true, subtitle: 'Engineer' });
  if (!h) return;
  const { meta, me } = h;
  const main = $('#main');
  const S = { projects: [], pid: null, project: null, period: null, per: null, drafts: null, months: {}, monthsPid: null, lensPeriod: null, reasons: {}, note: null };

  const DEFAULT_TO = { SUBAYBAYAN: 'DILG municipal field office', COA: 'COA resident auditor', IAS: 'Internal Audit Service', MPDO: 'Municipal Planning and Development Office', YEAR_END: 'Office of the Mayor and MPDO' };

  async function loadProjects() {
    S.projects = await api('/api/projects');
    S.projects.sort((a, b) => (b.mine - a.mine) || a.id.localeCompare(b.id));
    if (!S.pid) S.pid = (S.projects.find((p) => p.mine) || S.projects[0]).id;
  }
  async function loadProject() {
    S.project = await api(`/api/projects/${S.pid}`);
    if (!S.period || !S.project.periods.some((p) => p.period === S.period)) {
      S.period = S.project.periods.length ? S.project.periods[0].period : meta.today.slice(0, 7);
    }
  }
  async function loadPeriod() {
    S.per = await api(`/api/projects/${S.pid}/periods/${S.period}`);
    if (S.monthsPid !== S.pid) {
      S.months = {};
      S.monthsPid = S.pid;
      S.lensPeriod = null;
      S.note = null;
    }
    S.months[S.period] = S.per;
    if (S.viewFor !== `${S.pid}|${S.period}`) {
      S.viewFor = `${S.pid}|${S.period}`;
      S.lensPeriod = null;
      S.note = null;
      S.reasons = {};
    }
    await loadOtherMonths();
    S.drafts = null;
    if (S.per.percentComplete) {
      try {
        S.drafts = await api(`/api/projects/${S.pid}/periods/${S.period}/reports`);
      } catch (e) {
        S.drafts = null;
      }
    }
  }
  // Other months of this project (photos and rule checks), for the flipped sample and the comparison lens.
  async function loadOtherMonths() {
    const need = S.project.periods.map((x) => x.period).filter((p) => p !== S.period && !S.months[p]);
    const got = await Promise.all(need.map((p) => api(`/api/projects/${S.pid}/periods/${p}`).catch(() => null)));
    got.forEach((g, i) => {
      if (g) S.months[need[i]] = g;
    });
  }
  // The most recent earlier month with a photo.
  function prevMonthPhoto() {
    const earlier = Object.values(S.months)
      .filter((m) => m.period < S.period && m.photos && m.photos.length)
      .sort((a, b) => b.period.localeCompare(a.period));
    return earlier.length ? { period: earlier[0].period, label: earlier[0].label, photo: earlier[0].photos[0] } : null;
  }

  async function refresh() {
    await loadProject();
    await loadPeriod();
    render();
  }

  function projectList() {
    return `<div class="plist" data-testid="project-list">${S.projects
      .map((p) => `<button class="${p.id === S.pid ? 'on' : ''}" data-pid="${esc(p.id)}">${esc(p.name)}<span class="sub">${esc(p.id)} · ${p.mine ? 'you are in charge' : `in charge: ${esc(p.inChargeName)}`}</span></button>`)
      .join('')}</div>`;
  }

  function headerCard() {
    const p = S.project;
    const slip = p.slippage;
    const periods = new Set(p.periods.map((x) => x.period));
    const cur = meta.today.slice(0, 7);
    periods.add(cur);
    const opts = [...periods].sort().reverse();
    return `<div class="card"><div class="row"><div><h1>${esc(p.name)}</h1><div class="small">${esc(p.id)} · ${esc(p.contractId)} · ${esc(p.contractor)} · ${esc(p.location)}</div>
      <div class="small">Person in charge: ${esc(p.inChargeName)}${p.canWrite ? '' : ' · <b>read only for you</b>'}</div></div><div class="spacer"></div>
      <div><div class="small">Office percent complete</div><div class="big" data-testid="latest-pct">${p.latest ? `${esc(p.latest.value)}%` : 'none yet'}</div>
      <div class="small">${slip ? `planned ${esc(slip.planned)}% as of ${esc(fmtDate(slip.asOf))}, slippage ${slip.points > 0 ? '+' : ''}${esc(slip.points)} points` : ''}</div></div></div>
      <div class="row section"><label>Reporting period <select id="periodSel" data-testid="period-select">${opts.map((o) => `<option value="${o}" ${o === S.period ? 'selected' : ''}>${esc(monthLabel(o))}</option>`).join('')}</select></label>
      <label>Other month <input type="month" id="periodOther"></label>
      <span class="small">Milestone reports are expected at ${esc((p.milestones || []).map((m) => `${m.pct}%`).join(', '))}.${p.overdueMilestones.length ? ` <span class="chip lvl-1">${esc(p.overdueMilestones[0].pct)}% milestone overdue</span>` : ''}</span></div></div>`;
  }

  function photosCard() {
    const per = S.per;
    const dis = S.project.canWrite ? '' : 'disabled';
    return `<div class="card section" data-testid="photos-card"><h2><span class="step">1</span>Milestone photos for ${esc(per.label)}</h2>
      <p class="small">Upload the photos as they came off the camera or phone. Date and GPS stay in the file and are read if present; they are never required.</p>
      <div class="form"><label>Photos <input type="file" id="photoFiles" accept="image/*" multiple ${dis} data-testid="photo-input"></label>
      <label>Printed camera stamp, if the photo shows one (optional) <input id="stampText" placeholder="05-21-2026 Thu 11:12:21" ${dis}></label>
      <button class="primary" id="uploadBtn" ${dis} data-testid="upload-btn">Upload</button></div><div class="msg" id="upMsg"></div>${flipSample()}${cameraBox()}
      <div class="thumbs section">${per.photos.length ? per.photos.map((ph) => `<div class="thumb" data-testid="photo-thumb"><img src="${esc(ph.url)}" alt=""><div>${isTestPhoto(ph) ? '<span class="chip lvl-1" data-testid="test-photo">Test photo</span><br>' : ''}<b>${esc(ph.fileName)}</b><br>${ph.stampText ? `Stamp: ${esc(ph.stampText)}<br>` : ''}File date: ${esc(ph.exif && ph.exif.taken ? ph.exif.taken.replace('T', ' ') : 'none')}<br>GPS: ${esc(ph.exif && ph.exif.gps ? `${ph.exif.gps.lat.toFixed(5)}, ${ph.exif.gps.lon.toFixed(5)}` : 'none')}<br><span class="mini">${esc(ph.source === 'contractor' ? 'from the contractor' : `uploaded by ${ph.uploadedBy.name}`)}</span></div></div>`).join('') : '<p class="small">No photos for this period yet.</p>'}</div></div>`;
  }

  // A test photo made in the browser from last month's photo, mirrored, sent through the normal upload.
  function flipSample() {
    const prev = prevMonthPhoto();
    if (!S.project.canWrite || !prev) return '';
    return `<div class="flip-sample" data-testid="flip-sample"><div><b>Test photo</b> <span class="mini">Try the rule checks with a photo that should not pass quietly: ${esc(prev.label)}'s photo, mirrored, with its old printed stamp and a later file date. It goes through the same upload as any photo, so the real rule checks see it when you run the check.</span></div>
      <button id="flipBtn" data-testid="flip-btn">Try it: send last month's photo, flipped</button>
      <div class="test-photos"><div class="tp"><button data-test-photo="recompressed" data-testid="recompress-btn">Test photo: recompressed copy</button><span class="mini">Last month's photo saved again at low JPEG quality. The reuse check should still see it.</span></div>
      <div class="tp"><button data-test-photo="crop" data-testid="crop-btn">Test photo: 10% crop</button><span class="mini">10% cut off each side, then resized back. The check is expected not to catch this: a known limit of the reuse check.</span></div></div></div>`;
  }
  // A still photo from this device's camera, sent through the same upload.
  function cameraBox() {
    if (!S.project.canWrite) return '';
    return `<div class="cam-box" data-testid="cam-box"><button id="camBtn" data-testid="cam-btn">Take a site photo with this device's camera</button>
      <span class="mini">Gemini Live on video is on the roadmap; this takes a still photo.</span>
      <video id="camVideo" muted playsinline hidden></video>
      <div class="row" id="camCtl" hidden><button class="primary" id="camShot" data-testid="cam-shot">Capture and add</button><button id="camStop">Cancel</button></div>
      <div class="msg" id="camMsg"></div></div>`;
  }

  const isTestPhoto = (ph) => /^TEST-/.test(ph.fileName || '');

  function claimsCard() {
    const per = S.per;
    const dis = S.project.canWrite ? '' : 'disabled';
    const byKey = Object.fromEntries((per.claims || []).map((c) => [c.lineKey, c]));
    const src = per.claimsSource === 'contractor' ? `From the contractor's submission${per.submissions[0] ? ` received ${esc(fmtTime(per.submissions[0].receivedAt))}` : ''}.` : per.claimsSource === 'office' ? `Typed by the office (${esc(per.claimsUpdatedBy ? per.claimsUpdatedBy.name : '')}). Logged as monitoring work done for the contractor.` : 'Nothing received from the contractor yet. You can type what they claimed, or what they told you.';
    return `<div class="card section" data-testid="claims-card"><h2><span class="step">2</span>Progress claim: percent complete per line item</h2><p class="small">${src} Leave a line blank if it was not claimed this period.</p>
      <div class="tablewrap"><table><tr><th>Line item</th><th>Claimed</th><th></th></tr>${S.project.lines
        .map((l) => {
          const c = byKey[l.key];
          const val = c ? c.claimedPct : '';
          const input = l.status
            ? `<select data-claim="${esc(l.key)}" ${dis}><option value="" ${val === '' ? 'selected' : ''}>not claimed</option><option value="0" ${val === 0 ? 'selected' : ''}>${esc(l.status.none)}</option><option value="100" ${val === 100 ? 'selected' : ''}>${esc(l.status.done)}</option></select>`
            : `<input type="number" min="0" max="100" step="0.1" style="width:90px" data-claim="${esc(l.key)}" value="${esc(val)}" ${dis}> %`;
          return `<tr><td>${esc(l.label)}</td><td>${input}</td><td class="mini">${l.hidden ? "Hidden work: always can't tell from photos" : ''}</td></tr>`;
        })
        .join('')}</table></div>
      <div class="row section"><button id="saveClaims" ${dis} data-testid="save-claims">Save progress claim</button><span class="msg" id="claimMsg"></span></div></div>`;
  }

  function aiBanner(c) {
    const mode = c.aiMode;
    if (mode === 'mock') return `<span class="chip demo" data-testid="demo-badge">${esc(meta.phrases.mockReader)}</span>`;
    if (mode === 'saved') {
      const sr = c.savedRun || {};
      return `<span class="chip ai-banner" data-testid="ai-mode" data-mode="saved">Saved Gemini run, ${esc(sr.model || (c.models && c.models.A) || 'Gemini')}, ${esc(fmtDate(sr.at || c.runAt))}</span>`;
    }
    if (mode === 'needs_code') return `<span class="chip ai-banner wait" data-testid="ai-mode" data-mode="needs_code">Rule checks ran. The AI reading needs the judge access code.</span>`;
    return `<span data-testid="ai-mode" data-mode="${esc(mode)}">Readers: ${esc(c.models.A)} and ${esc(c.models.B)}.</span>`;
  }
  const awaitingAI = (c, l) => c.aiMode === 'needs_code' || ['A', 'B'].some((k) => l.readers && l.readers[k] && l.readers[k].mode === 'needs_code');

  function checkCard() {
    const per = S.per;
    const c = per.check;
    const dis = S.project.canWrite ? '' : 'disabled';
    let body = '<p class="small">Not checked yet.</p>';
    if (c) {
      const mock = c.aiMode === 'mock';
      const photo = per.photos.find((p) => p.id === c.photoIds[0]);
      const boxes = c.lines
        .map((l) => {
          const r = (l.readers.A && l.readers.A.box ? l.readers.A : null) || (l.readers.B && l.readers.B.box ? l.readers.B : null);
          return r && (r.photoIndex || 0) === 0 ? { id: l.lineKey, box: r.box, verdict: l.aiDefault, label: l.label } : null;
        })
        .filter(Boolean);
      body = `<p class="small">Run ${esc(fmtTime(c.runAt))} by ${esc(c.runBy.name)}. ${aiBanner(c)}
        ${c.readerErrors && c.readerErrors.A ? `<br><span class="msg err">Reader A: ${esc(c.readerErrors.A)}</span>` : ''}${c.readerErrors && c.readerErrors.B ? `<br><span class="msg err">Reader B: ${esc(c.readerErrors.B)}</span>` : ''}</p>
        <div class="grid cols-2"><div>${photo ? `<div id="lensStage">${stage(photo.url, boxes)}</div><div id="lensPicker" class="section"></div><p class="mini">The demo's monthly frames were prepared from one fixed camera and aligned to the same view. Uploaded photos are not aligned; the rule check only says whether two views look comparable, and when they do not line up the honest answer is "not comparable".</p>` : '<p class="small" data-testid="no-photo-hint">No photo for this period yet, so every line is "no answer" until photos arrive. The comparison lens and swipe appear on months that have a photo: pick April 2026 above, or send a photo in step 1.</p>'}
          <h3 class="section">Photo checks (no AI)</h3>${c.photoChecks.map((pc) => `<div class="small"><b>${esc(pc.fileName)}</b></div>${findings(pc.findings)}`).join('') || '<p class="small">No photos.</p>'}${qualityPanel(per, c)}</div>
        <div data-testid="line-results">${per.canDecide ? '<p class="small decide-intro">You have the last word on each line. One click records your call; pick or type a reason first if you like. The decision log keeps the AI default and your decision.</p>' : '<p class="small">Read only for you. The engineer in charge and the office head decide each line.</p>'}${c.lines.map((l) => lineCard(l, mock, c)).join('')}</div></div>`;
    }
    return `<div class="card section" data-testid="check-card"><h2><span class="step">3</span>Check the claim against the photos</h2>
      <p class="small">Each line becomes one question a photo can answer. Rule checks run first (dates, location, reuse, whether two months' views compare), then two independent readers answer each question. A person then decides every line: the engineer in charge, or the office head.</p>
      <div class="row"><button class="primary" id="runCheck" ${dis} data-testid="run-check">Run the check</button><span class="msg" id="checkMsg"></span></div>${S.per.checkStale ? `<p class="banner-note" data-testid="check-stale"><b>This check is out of date.</b> ${esc(S.per.checkStaleReason || 'The photos or claims changed after it ran.')} Run the check again; until then its lines count as undecided.</p>` : ''}${body}</div>`;
  }

  // Photo quality rates the photo as evidence, kept apart from the line verdicts, which rate the work.
  function qualityPanel(per, c) {
    const pcs = (c.photoChecks || []).filter((pc) => pc && pc.findings);
    if (!pcs.length) return '';
    const worst = (list) => (list.some((f) => f.level === 'flag') ? 'flag' : list.some((f) => f.level !== 'ok') ? 'note' : 'ok');
    const row = (k, label, level, text) => `<div class="pq-row" data-q="${esc(k)}" data-level="${esc(level)}"><span class="pq-k">${esc(label)}</span><span class="pq-lvl ${esc(level)}">${esc(level)}</span><span>${esc(text)}</span></div>`;
    const blocks = pcs.map((pc) => {
      const ph = per.photos.find((p) => p.id === pc.photoId) || per.photos.find((p) => p.fileName === pc.fileName) || {};
      const gps = !!(ph.exif && ph.exif.gps);
      const dates = pc.findings.filter((f) => /^(date|stamp|capture_date)/.test(f.key || ''));
      const dLevel = dates.length ? worst(dates) : 'note';
      const dText = dates.length ? dates.map((f) => f.title).join('; ') : 'No printed stamp or file date to compare with the period.';
      const comp = pc.findings.find((f) => f.key === 'comparable');
      const cLevel = !comp || !comp.comparable ? 'note' : comp.comparable === 'yes' ? 'ok' : comp.comparable === 'no' ? 'flag' : 'note';
      const cText = comp ? comp.title : 'Not checked.';
      const w = Number(ph.width) || 0;
      const hgt = Number(ph.height) || 0;
      const rText = w ? `${w} x ${hgt} px${w >= 1000 ? '' : ', under 1000 px wide'}` : 'Size not known.';
      return `<div class="pq-photo" data-testid="photo-quality-photo"><div class="small"><b>${esc(pc.fileName || ph.fileName || 'Photo')}</b></div>
        ${row('gps', 'GPS in file', gps ? 'ok' : 'note', gps ? 'Yes' : 'No')}
        ${row('dates', 'Stamp, file date and period', dLevel, dText)}
        ${row('view', 'View comparable with last month', cLevel, cText)}
        ${row('resolution', 'Resolution', w >= 1000 ? 'ok' : 'note', rText)}</div>`;
    });
    return `<div class="photo-quality" data-testid="photo-quality"><h3>Photo quality</h3><p class="mini">This rates the photo as evidence, not the work.</p>${blocks.join('')}</div>`;
  }

  function readerBox(name, r, mock, waiting) {
    if (waiting && (!r || r.mode === 'needs_code' || !r.verdict)) return `<div class="reader"><b>${name}</b> <span class="chip wait" data-verdict="awaiting">Awaiting the AI reading</span></div>`;
    if (!r || !r.verdict) return `<div class="reader"><b>${name}</b> ${chip('no_answer')}</div>`;
    return `<div class="reader"><b>${name}</b> ${chip(r.verdict)} ${r.confidence ? `<span class="mini">${esc(r.confidence)} confidence</span>` : ''}${mock ? ' <span class="chip demo">demo</span>' : ''}<div class="mini">${esc(r.reason)}</div></div>`;
  }

  const DECIDABLE = ['supported', 'contradicted', 'not_assessable'];
  const PICKS = ['Visible in the photo', 'Not visible from this camera', 'Hidden work', 'The photo shows otherwise', 'Agree with both readers'];
  const ROLE = { engineer: 'engineer in charge', reviewer: 'office head' };
  function defaultReason(l, decision, agree) {
    if (agree) return l.hidden ? 'Hidden work; cannot be seen from the camera.' : 'Agree with the AI default; checked against the photo.';
    if (decision === 'supported') return 'Visible in the photo';
    if (decision === 'contradicted') return 'The photo shows otherwise';
    return l.hidden ? 'Hidden work' : 'Not visible from this camera';
  }

  function lineCard(l, mock, c) {
    const d = l.decision;
    const waiting = awaitingAI(c, l);
    const ruleDefault = waiting && l.hiddenRule;
    const def = waiting && !ruleDefault ? null : l.aiDefault;
    const defHtml = def ? `<span class="mini">${ruleDefault ? 'Rule default' : 'AI default'}</span> ${chip(def)}` : '<span class="mini">AI default</span> <span class="chip wait" data-testid="ai-awaiting">Awaiting the AI reading</span>';
    const decided = d
      ? `<div class="decided" data-testid="decision" data-decision="${esc(d.decision)}" data-overrode="${d.overrode ? '1' : '0'}">Decision: ${chip(d.decision)} ${d.overrode && DECIDABLE.includes(l.aiDefault) && !waiting ? `<span class="chip override" data-testid="override">Overrides the AI default (${esc(window.PoP.VL[l.aiDefault])})</span>` : d.overrode ? `<span class="mini">No AI default${waiting ? '' : ` (${esc((window.PoP.VL[l.aiDefault] || l.aiDefault).toLowerCase())})`}; a person decided</span>` : '<span class="mini">matches the AI default</span>'}
          <div class="mini">${esc(d.reason)} · ${esc(d.by.name)}${d.by.role && ROLE[d.by.role] ? `, ${esc(ROLE[d.by.role])}` : ''}, ${esc(fmtTime(d.at))}. The decision log keeps the AI default and this decision.</div></div>`
      : `<div class="mini decided" data-testid="decision">Awaiting a decision.${l.earlierDecision ? ` On an earlier run of this check, ${esc(l.earlierDecision.by.name)} decided ${esc(window.PoP.VL[l.earlierDecision.decision] || l.earlierDecision.decision)}; the photos or claims have changed since, so it needs a new decision.` : ''}</div>`;
    let controls = '';
    if (S.per.canDecide) {
      const agreeOk = def && DECIDABLE.includes(def);
      const val = S.reasons[l.lineKey] != null ? S.reasons[l.lineKey] : '';
      controls = `<div class="decide" data-testid="decide-${esc(l.lineKey)}">
        ${agreeOk ? `<button class="agree" data-decide="${esc(def)}" data-agree="1" data-key="${esc(l.lineKey)}" data-testid="agree-${esc(l.lineKey)}">Agree: ${esc(window.PoP.VL[def])}</button>` : ''}
        ${DECIDABLE.map((v) => `<button class="${d && d.decision === v ? 'on' : ''}" data-decide="${v}" data-key="${esc(l.lineKey)}" data-testid="decide-${esc(l.lineKey)}-${v}">${esc(window.PoP.VL[v])}</button>`).join('')}
        <input data-reason="${esc(l.lineKey)}" data-testid="reason-${esc(l.lineKey)}" value="${esc(val)}" placeholder="Reason (a quick pick fills it; edit if needed)" maxlength="300">
        <div class="picks">${PICKS.map((pk) => `<button class="pick" data-pick="${esc(pk)}" data-key="${esc(l.lineKey)}">${esc(pk)}</button>`).join('')}</div>
        <span class="msg" data-dmsg="${esc(l.lineKey)}"></span></div>`;
    }
    return `<div class="line" data-line="${esc(l.lineKey)}"><div class="row"><span class="lab">${esc(l.label)}</span><span class="spacer"></span>${defHtml}</div>
      <div class="mini">Claim: ${esc(l.statement)}</div><div class="q">Question: ${esc(l.question)}</div>
      <div class="readers">${readerBox('Reader A', l.readers.A, mock, waiting)}${readerBox('Reader B', l.readers.B, mock, waiting)}</div>
      ${l.note && !waiting ? `<div class="mini" style="margin-top:6px">${esc(l.note)}</div>` : ''}
      ${decided}${controls}</div>`;
  }

  function percentCard() {
    const pc = S.per.percentComplete;
    const canEnter = S.project.canWrite && me.role === 'engineer';
    const drafts = S.drafts
      ? `<div class="grid cols-4 section">${S.drafts.drafts
          .map(
            (d) => `<div class="draft" data-testid="draft-${esc(d.kind)}"><div class="small">${esc(d.agency)}</div><h3>${esc(d.name)}</h3><div class="small">${esc(d.periodLabel)} · due ${esc(fmtDate(d.due))}</div>
            <div class="pct" data-testid="draft-pct">${esc(d.percent)}%</div>${d.narrative ? `<p class="mini" data-testid="narrative">${esc(d.narrative)}</p>` : ''}
            <div class="row"><a class="btn" href="${esc(PoP.base)}/api/projects/${esc(S.pid)}/periods/${esc(S.period)}/reports/${esc(d.kind)}.txt">Text</a><a class="btn" href="${esc(PoP.base)}/api/projects/${esc(S.pid)}/periods/${esc(S.period)}/reports/${esc(d.kind)}.csv">CSV</a><a class="btn" target="_blank" rel="noopener" href="${esc(PoP.base)}/api/projects/${esc(S.pid)}/periods/${esc(S.period)}/reports/${esc(d.kind)}.html">Printable</a></div></div>`
          )
          .join('')}</div><p class="small">${esc(S.drafts.note)} You submit each one yourself, then log it below.</p>`
      : '<p class="small">Enter the percent complete to make the four drafts.</p>';
    return `<div class="card section" data-testid="percent-card"><h2><span class="step">4</span>Percent complete: enter it once</h2>
      <p class="small">One number for the whole project this period. It fills the COA, DILG SubayBAYAN, IAS and MPDO drafts.</p>
      <div class="form"><label>Percent complete for ${esc(S.per.label)} <input type="number" min="0" max="100" step="0.1" id="pctInput" value="${pc ? esc(pc.value) : ''}" ${canEnter ? '' : 'disabled'} data-testid="pct-input"></label>
      <label>MPDO narrative (optional; leave blank to use the generated one) <textarea id="narr" rows="2" ${canEnter ? '' : 'disabled'}>${esc(S.per.narrativeOverride)}</textarea></label>
      <button class="primary" id="savePct" ${canEnter ? '' : 'disabled'} data-testid="save-pct">Save and make drafts</button></div>
      <div class="msg" id="pctMsg">${pc ? `Entered by ${esc(pc.enteredByName)}, ${esc(fmtTime(pc.enteredAt))}.` : ''}</div>${drafts}${draftNoteBox(canEnter)}</div>`;
  }

  // Long-cut beat: Gemini drafts a plain-language note from the decision log only. A person edits it
  // and sends it; nothing goes out automatically.
  const AUDIENCES = { office: 'Office (municipal engineering)', mayor: 'Mayor', public: 'Public' };
  function noteLabel(n) {
    if (!n) return 'Draft from the decision log only. Nothing is sent.';
    return n.saved ? `Saved Gemini draft from ${fmtTime(n.at)}, model ${n.model}. From the decision log only; nothing is sent.` : `Gemini draft, model ${n.model}, ${fmtTime(n.at)}. From the decision log only; nothing is sent.`;
  }
  function draftNoteBox(canEnter) {
    const n = S.note;
    return `<div class="note-draft section" data-testid="draft-note"><h3>Plain-language note</h3>
      <p class="small">Gemini drafts a short note from the decision log only (the AI defaults and each person's decision). You edit it and send it yourself. Nothing goes out automatically.</p>
      <div class="row"><label>For <select id="dnAudience" data-testid="draft-audience">${Object.entries(AUDIENCES).map(([k, v]) => `<option value="${k}" ${n && n.audience === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <button class="primary" id="dnBtn" data-testid="draft-gemini">Draft with Gemini</button><span class="msg" id="dnMsg"></span></div>
      <label class="section"><span id="dnLabel" data-testid="draft-label">${esc(noteLabel(n))}</span>
      <textarea id="dnText" rows="6" data-testid="draft-text" placeholder="The draft appears here. Edit it before you use it.">${esc(n ? n.text : '')}</textarea></label>
      <div class="row"><button id="dnUse" data-testid="draft-use" ${canEnter ? '' : 'disabled'}>Use as the report narrative</button><span class="mini">Saves it as the MPDO narrative for ${esc(S.per.label)}, with the percent complete above.</span></div></div>`;
  }
  async function draftNote() {
    const audience = $('#dnAudience').value;
    setMsg($('#dnMsg'), 'Drafting from the decision log...');
    $('#dnBtn').disabled = true;
    let r;
    let data = null;
    try {
      r = await fetch(PoP.url(`/api/projects/${S.pid}/periods/${S.period}/draft-note`), { method: 'POST', headers: { 'x-pop-request': '1', 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ audience }) });
      try {
        data = await r.json();
      } catch (e) {
        data = null;
      }
    } catch (e) {
      $('#dnBtn').disabled = false;
      return setMsg($('#dnMsg'), 'Could not reach the server.', 'err');
    }
    $('#dnBtn').disabled = false;
    if (!r.ok) {
      if (r.status === 403 && data && data.needsCode) return setMsg($('#dnMsg'), 'Live Gemini actions need the judge access code (enter it on the sign-in page).', 'err');
      if (r.status === 404) return setMsg($('#dnMsg'), 'Drafting is not available on this server yet.', 'err');
      return setMsg($('#dnMsg'), (data && data.error) || `Request failed (${r.status})`, 'err');
    }
    S.note = { audience, text: data.text || '', model: data.model || 'Gemini', at: data.at, saved: !!data.saved };
    $('#dnLabel').textContent = noteLabel(S.note);
    setMsg($('#dnMsg'), 'Draft ready. Edit it before you use it.', 'ok');
    revealText($('#dnText'), S.note.text);
  }
  // Let the note appear word by word (about two seconds at most), so it reads as it is written.
  function revealText(el, text) {
    const words = text.split(/(\s+)/);
    const step = Math.max(1, Math.ceil(words.length / 60));
    let i = 0;
    el.value = '';
    el.dataset.done = '0';
    const tick = () => {
      i = Math.min(words.length, i + step);
      el.value = words.slice(0, i).join('');
      if (i < words.length) setTimeout(tick, 30);
      else el.dataset.done = '1';
    };
    tick();
  }

  function transmittalCard() {
    const p = S.project;
    const dis = p.canWrite ? '' : 'disabled';
    const obl = p.obligations.filter((o) => o.status !== 'upcoming').slice(-12).reverse();
    return `<div class="card section" data-testid="transmittal-card"><h2><span class="step">5</span>Report submissions: log what was actually sent</h2>
      <p class="small">The tool sends nothing. After you submit a report, record when, to whom and how, with a photo of the receiving copy if you have one. A report logged after its due date is flagged as late and does not count as on time.</p>
      <div class="form"><label>Report <select id="trKind" ${dis} data-testid="tr-kind">${Object.entries(meta.reportKinds).map(([k, v]) => `<option value="${k}" ${k === 'COA' ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
      <label>Period (month, quarter or year) <input id="trPeriod" value="${esc(S.period)}" ${dis}></label>
      <label>Date submitted <input type="date" id="trDate" value="${esc(meta.today)}" max="${esc(meta.today)}" ${dis} data-testid="tr-date"></label>
      <label>Received by <input id="trTo" value="${esc(DEFAULT_TO.COA)}" ${dis} data-testid="tr-to"></label>
      <label>How <input id="trVia" placeholder="Hand-carried, encoded online" ${dis}></label>
      <label>Reference no. <input id="trRef" ${dis}></label>
      <label>Transmittal photo (optional) <input type="file" id="trPhoto" accept="image/*" ${dis}></label>
      <button class="primary" id="trSave" ${dis} data-testid="tr-save">Log submission</button></div><div class="msg" id="trMsg"></div>
      <h3 class="section">Due and recent</h3><div class="tablewrap"><table data-testid="obligations"><tr><th>Report</th><th>Due</th><th>Status</th><th>Submitted</th></tr>${obl
        .map((o) => `<tr><td>${esc(o.label)}</td><td>${esc(fmtDate(o.due))}</td><td>${statusChip(o.status)}${o.status === 'overdue' ? ` <span class="mini">${esc(o.daysOverdue)} days</span>` : ''}</td><td>${esc(o.submittedOn ? fmtDate(o.submittedOn) : '')}</td></tr>`)
        .join('')}</table></div>
      <h3 class="section">Submission log</h3><div class="tablewrap"><table data-testid="transmittals"><tr><th>Report</th><th>Period</th><th>Submitted</th><th>To</th><th>Status</th><th>Logged by</th></tr>${p.transmittals
        .slice(0, 15)
        .map((t) => `<tr><td>${esc(t.reportName)}</td><td>${esc(t.periodKey)}</td><td>${esc(fmtDate(t.submittedOn))}</td><td>${esc(t.to)}${t.photoId ? ' · photo' : ''}</td><td>${statusChip(t.late ? 'late' : 'on_time')}</td><td>${esc(t.loggedBy.name)}</td></tr>`)
        .join('')}</table></div></div>`;
  }

  function monitoringCard() {
    const p = S.project;
    const dis = p.canWrite ? '' : 'disabled';
    return `<div class="card section" data-testid="monitoring-card"><h2><span class="step">6</span>Monitoring work (credit)</h2>
      <p class="small">Site visits, remote checks and reports written on the contractor's behalf. The reviewer sees these in the Monday view.</p>
      <div class="form"><label>Date <input type="date" id="monDate" value="${esc(meta.today)}" ${dis}></label>
      <label>What <select id="monKind" ${dis} data-testid="mon-kind">${meta.monitoringKinds.map((k) => `<option>${esc(k)}</option>`).join('')}</select></label>
      <label>Hours <input type="number" id="monHours" min="0" max="24" step="0.5" value="2" ${dis}></label>
      <label>Note <input id="monNote" ${dis} data-testid="mon-note"></label>
      <button class="primary" id="monSave" ${dis} data-testid="mon-save">Log work</button></div><div class="msg" id="monMsg"></div>
      <div class="tablewrap section"><table data-testid="monitoring"><tr><th>Date</th><th>What</th><th>Hours</th><th>Note</th><th>By</th></tr>${p.monitoring
        .map((m) => `<tr><td>${esc(fmtDate(m.date))}</td><td>${esc(m.kind)}</td><td>${esc(m.hours == null ? '' : m.hours)}</td><td>${esc(m.note)}</td><td>${esc(m.by.name)}</td></tr>`)
        .join('')}</table></div>
      ${p.canWrite ? `<h3 class="section">Contractor link</h3><p class="small">The contractor sends the progress claim and photos through a link for this project. Making a new link stops the old one. You send it yourself.</p><button id="newLink" data-testid="new-link">Make a new contractor link</button><div class="msg" id="linkMsg"></div>` : ''}</div>`;
  }

  function render() {
    main.innerHTML = `<div class="side"><aside><h3>Projects</h3>${projectList()}</aside><div>${headerCard()}${photosCard()}${claimsCard()}${checkCard()}${percentCard()}${transmittalCard()}${monitoringCard()}</div></div>`;
    wire();
  }

  function wire() {
    $$('[data-pid]').forEach((b) => (b.onclick = async () => {
      S.pid = b.dataset.pid;
      S.period = null;
      await refresh();
    }));
    $('#periodSel').onchange = async (e) => {
      S.period = e.target.value;
      await loadPeriod();
      render();
    };
    $('#periodOther').onchange = async (e) => {
      if (!e.target.value) return;
      S.period = e.target.value;
      await loadPeriod();
      render();
    };
    $('#uploadBtn').onclick = async () => {
      const files = $('#photoFiles').files;
      if (!files.length) return setMsg($('#upMsg'), 'Choose a photo first.', 'err');
      const fd = new FormData();
      for (const f of files) fd.append('photos', f);
      fd.append('stampText', $('#stampText').value);
      setMsg($('#upMsg'), 'Uploading...');
      try {
        await api(`/api/projects/${S.pid}/periods/${S.period}/photos`, { method: 'POST', form: fd });
        await refresh();
        setMsg($('#upMsg'), 'Uploaded.', 'ok');
      } catch (e) {
        setMsg($('#upMsg'), e.message, 'err');
      }
    };
    $('#saveClaims').onclick = async () => {
      const claims = $$('[data-claim]').map((i) => ({ lineKey: i.dataset.claim, claimedPct: i.value === '' ? null : Number(i.value) })).filter((c) => c.claimedPct !== null);
      try {
        await api(`/api/projects/${S.pid}/periods/${S.period}/claims`, { method: 'PUT', body: { claims } });
        await refresh();
        setMsg($('#claimMsg'), `Saved ${claims.length} line(s).`, 'ok');
      } catch (e) {
        setMsg($('#claimMsg'), e.message, 'err');
      }
    };
    $('#runCheck').onclick = async () => {
      setMsg($('#checkMsg'), 'Checking...');
      try {
        await api(`/api/projects/${S.pid}/periods/${S.period}/check`, { method: 'POST' });
        await refresh();
        setMsg($('#checkMsg'), 'Done. Decide each line below; the AI default is only a starting point.', 'ok');
      } catch (e) {
        setMsg($('#checkMsg'), e.message, 'err');
      }
    };
    $$('[data-pick]').forEach((b) => (b.onclick = () => {
      const inp = $(`[data-reason="${b.dataset.key}"]`);
      inp.value = b.dataset.pick;
      S.reasons[b.dataset.key] = inp.value;
      inp.focus();
    }));
    $$('[data-reason]').forEach((i) => (i.oninput = () => (S.reasons[i.dataset.reason] = i.value)));
    $$('[data-decide]').forEach((b) => (b.onclick = () => decide(b)));
    const fb = $('#flipBtn');
    if (fb) fb.onclick = () => sendTestPhoto('flipped');
    $$('[data-test-photo]').forEach((b) => (b.onclick = () => sendTestPhoto(b.dataset.testPhoto)));
    wireCamera();
    $('#dnBtn').onclick = draftNote;
    $('#dnText').oninput = (e) => {
      if (S.note) S.note.text = e.target.value;
      else S.note = { audience: $('#dnAudience').value, text: e.target.value, model: null, at: null, saved: false, typed: true };
    };
    $('#dnUse').onclick = useNote;
    attachLens();
    $$('.line[data-line]').forEach((el) => {
      el.onmouseenter = () => $$(`.box[data-box="${el.dataset.line}"]`).forEach((b) => b.classList.add('hl'));
      el.onmouseleave = () => $$('.box').forEach((b) => b.classList.remove('hl'));
    });
    $('#savePct').onclick = async () => {
      try {
        await api(`/api/projects/${S.pid}/periods/${S.period}/percent`, { method: 'PUT', body: { value: $('#pctInput').value, narrative: $('#narr').value } });
        await refresh();
        setMsg($('#pctMsg'), 'Saved. The four drafts below all use this number.', 'ok');
      } catch (e) {
        setMsg($('#pctMsg'), e.message, 'err');
      }
    };
    $('#trKind').onchange = (e) => {
      $('#trTo').value = DEFAULT_TO[e.target.value] || '';
      $('#trPeriod').value = e.target.value === 'YEAR_END' ? S.period.slice(0, 4) : S.period;
    };
    $('#trSave').onclick = async () => {
      const fd = new FormData();
      fd.append('reportKind', $('#trKind').value);
      fd.append('periodKey', $('#trPeriod').value);
      fd.append('submittedOn', $('#trDate').value);
      fd.append('to', $('#trTo').value);
      fd.append('via', $('#trVia').value);
      fd.append('refNo', $('#trRef').value);
      if ($('#trPhoto').files[0]) fd.append('photo', $('#trPhoto').files[0]);
      try {
        const r = await api(`/api/projects/${S.pid}/transmittals`, { method: 'POST', form: fd });
        await refresh();
        setMsg($('#trMsg'), r.transmittal.late ? `Logged. It was due ${fmtDate(r.transmittal.due)}, so it is flagged as late and not counted as on time.` : `Logged as on time (due ${fmtDate(r.transmittal.due)}).`, r.transmittal.late ? 'err' : 'ok');
      } catch (e) {
        setMsg($('#trMsg'), e.message, 'err');
      }
    };
    $('#monSave').onclick = async () => {
      try {
        await api(`/api/projects/${S.pid}/monitoring`, { method: 'POST', body: { date: $('#monDate').value, kind: $('#monKind').value, hours: $('#monHours').value, note: $('#monNote').value } });
        await refresh();
        setMsg($('#monMsg'), 'Logged.', 'ok');
      } catch (e) {
        setMsg($('#monMsg'), e.message, 'err');
      }
    };
    const nl = $('#newLink');
    if (nl)
      nl.onclick = async () => {
        try {
          const r = await api(`/api/projects/${S.pid}/contractor-link`, { method: 'POST' });
          $('#linkMsg').innerHTML = `${esc(r.note)}<br><code data-testid="new-link-value">${esc(location.origin + r.link)}</code>`;
        } catch (e) {
          setMsg($('#linkMsg'), e.message, 'err');
        }
      };
  }

  // One click records the person's decision for a line; the reason field is optional to edit.
  async function decide(b) {
    const key = b.dataset.key;
    const line = S.per.check.lines.find((l) => l.lineKey === key);
    const typed = ($(`[data-reason="${key}"]`).value || '').trim();
    const reason = typed || defaultReason(line, b.dataset.decide, !!b.dataset.agree);
    $$(`[data-key="${key}"]`).forEach((x) => (x.disabled = true));
    setMsg($(`[data-dmsg="${key}"]`), 'Saving...');
    try {
      await api(`/api/projects/${S.pid}/periods/${S.period}/decisions`, { method: 'POST', body: { lineKey: key, decision: b.dataset.decide, reason } });
      delete S.reasons[key];
      await loadPeriod();
      render();
      const msg = $(`[data-dmsg="${key}"]`);
      const d = (S.per.check.lines.find((l) => l.lineKey === key) || {}).decision;
      setMsg(msg, d && d.overrode ? 'Saved. Your decision overrides the AI default; the log keeps both.' : 'Saved. The log keeps the AI default and your decision.', 'ok');
    } catch (e) {
      $$(`[data-key="${key}"]`).forEach((x) => (x.disabled = false));
      setMsg($(`[data-dmsg="${key}"]`), e.message, 'err');
    }
  }

  // Build the test photo in the browser and upload it through the normal endpoint.
  function loadImg(url) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('Could not load last month\'s photo.'));
      im.src = url;
    });
  }
  // A minimal EXIF block holding only DateTimeOriginal, so the test photo carries a file date
  // that disagrees with its printed stamp (as a re-saved copy would).
  function exifSegment(when) {
    const date = `${when.slice(0, 4)}:${when.slice(5, 7)}:${when.slice(8, 10)} ${when.slice(11, 16) || '08:00'}:00`;
    const tiff = new Uint8Array(64);
    const dv = new DataView(tiff.buffer);
    tiff.set([0x49, 0x49, 0x2a, 0x00], 0);
    dv.setUint32(4, 8, true);
    dv.setUint16(8, 1, true); // IFD0: one entry, the pointer to the Exif IFD
    dv.setUint16(10, 0x8769, true);
    dv.setUint16(12, 4, true);
    dv.setUint32(14, 1, true);
    dv.setUint32(18, 26, true);
    dv.setUint32(22, 0, true);
    dv.setUint16(26, 1, true); // Exif IFD: DateTimeOriginal
    dv.setUint16(28, 0x9003, true);
    dv.setUint16(30, 2, true);
    dv.setUint32(32, 20, true);
    dv.setUint32(36, 44, true);
    dv.setUint32(40, 0, true);
    for (let i = 0; i < 19; i++) tiff[44 + i] = date.charCodeAt(i);
    const seg = new Uint8Array(4 + 6 + tiff.length);
    seg.set([0xff, 0xe1, ((seg.length - 2) >> 8) & 0xff, (seg.length - 2) & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0], 0);
    seg.set(tiff, 10);
    return seg;
  }
  const TEST_KINDS = {
    flipped: { file: 'flipped', done: 'mirrored', quality: 0.9 },
    recompressed: { file: 'recompressed', done: 'saved again at low JPEG quality', quality: 0.35 },
    crop: { file: 'cropped-10pc', done: 'with 10% cut off each side and resized back (a known limit of the reuse check)', quality: 0.9 }
  };
  async function sendTestPhoto(kind) {
    const prev = prevMonthPhoto();
    const k = TEST_KINDS[kind];
    if (!prev || !k) return;
    setMsg($('#upMsg'), `Making the test photo from ${prev.label}'s photo...`);
    try {
      const im = await loadImg(prev.photo.url);
      const cv = document.createElement('canvas');
      cv.width = im.naturalWidth;
      cv.height = im.naturalHeight;
      const ctx = cv.getContext('2d');
      if (kind === 'flipped') {
        ctx.translate(cv.width, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(im, 0, 0);
      } else if (kind === 'crop') {
        const dx = Math.round(cv.width * 0.1);
        const dy = Math.round(cv.height * 0.1);
        ctx.drawImage(im, dx, dy, cv.width - 2 * dx, cv.height - 2 * dy, 0, 0, cv.width, cv.height);
      } else {
        ctx.drawImage(im, 0, 0);
      }
      const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', k.quality));
      const jpg = new Uint8Array(await blob.arrayBuffer());
      const fileDate = (prev.photo.exif && prev.photo.exif.taken && prev.photo.exif.taken.slice(0, 7) !== prev.period ? prev.photo.exif.taken : `${meta.today}T08:00`);
      const seg = exifSegment(fileDate);
      const out = new Uint8Array(jpg.length + seg.length);
      out.set(jpg.subarray(0, 2), 0);
      out.set(seg, 2);
      out.set(jpg.subarray(2), 2 + seg.length);
      const fd = new FormData();
      fd.append('photos', new Blob([out], { type: 'image/jpeg' }), `TEST-${k.file}-copy-of-${prev.period}.jpg`);
      fd.append('stampText', prev.photo.stampText || '');
      await api(`/api/projects/${S.pid}/periods/${S.period}/photos`, { method: 'POST', form: fd });
      await refresh();
      setMsg($('#upMsg'), `Test photo sent: ${prev.label}'s photo, ${k.done}. Now press "Run the check" in step 3; the rule checks run before any AI.`, 'ok');
    } catch (e) {
      setMsg($('#upMsg'), e.message, 'err');
    }
  }

  // Camera: one still frame from the device camera, uploaded like any photo. The stream stops after.
  let camStream = null;
  function stopCam() {
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }
  function wireCamera() {
    stopCam(); // a re-render removed any earlier preview
    const btn = $('#camBtn');
    if (!btn) return;
    const video = $('#camVideo');
    const ctl = $('#camCtl');
    const msg = $('#camMsg');
    const close = () => {
      stopCam();
      video.srcObject = null;
      video.hidden = true;
      ctl.hidden = true;
      btn.disabled = false;
    };
    btn.onclick = async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setMsg(msg, 'No camera is available in this browser. Upload a photo from the device instead.', 'err');
        return;
      }
      btn.disabled = true;
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = camStream;
        video.hidden = false;
        ctl.hidden = false;
        await video.play();
        setMsg(msg, 'Point the camera at the work, then press "Capture and add".');
      } catch (e) {
        close();
        setMsg(msg, 'The camera is not available or permission was not given. Upload a photo from the device instead.', 'err');
      }
    };
    $('#camStop').onclick = () => {
      close();
      setMsg(msg, '');
    };
    $('#camShot').onclick = async () => {
      if (!camStream || !video.videoWidth) return;
      const cv = document.createElement('canvas');
      cv.width = video.videoWidth;
      cv.height = video.videoHeight;
      cv.getContext('2d').drawImage(video, 0, 0);
      close();
      try {
        const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.9));
        const fd = new FormData();
        const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        fd.append('photos', blob, `camera-${ts}.jpg`);
        fd.append('stampText', '');
        setMsg(msg, 'Uploading the photo...');
        await api(`/api/projects/${S.pid}/periods/${S.period}/photos`, { method: 'POST', form: fd });
        await refresh();
        setMsg($('#upMsg'), 'Camera photo added. A browser capture carries no file date or GPS; run the check in step 3 when ready.', 'ok');
      } catch (e) {
        setMsg($('#camMsg'), e.message, 'err');
      }
    };
  }

  // The saved AI illustration of the finished building (made once; Lens and Swipe cost nothing).
  const FINISHED_LOOK = () => ({ period: 'ai-finished', label: 'AI finished look (illustration)', url: PoP.url('/static/finished-look.jpg'), status: 'aligned', ai: true, note: 'Made once by Gemini 3.1 Flash Image from the April 2026 frame; an illustration, not evidence and not the design. Not used by any check.' });

  // Comparison lens over the checked photo, other months at the same spot.
  function lensMonths() {
    const c = S.per.check;
    const cur = S.per.photos.find((p) => p.id === c.photoIds[0]);
    const pc0 = c.photoChecks.find((x) => x.photoId === c.photoIds[0]) || c.photoChecks[0];
    const comp = pc0 && pc0.findings.find((f) => f.key === 'comparable');
    // Test photos (the flipped sample) are left out: the lens compares real months only.
    const real = (m) => (m.photos || []).find((x) => !isTestPhoto(x));
    return Object.values(S.months)
      .filter((m) => m.period !== S.period && real(m))
      .sort((a, b) => b.period.localeCompare(a.period))
      .map((m) => {
        const ph = real(m);
        // Only the prepared demo frames are known to be aligned; any other pair is "alignment not checked".
        const prepared = (x) => x && /source video clip/.test(x.metadataSource || '');
        let status = prepared(ph) && prepared(cur) ? 'aligned' : 'unknown';
        let note = status === 'aligned' ? 'Prepared demo frames, aligned to the same view.' : 'Alignment not checked for this pair: uploaded photos are not aligned.';
        if (comp && comp.comparable && comp.title.includes(m.period)) {
          status = comp.comparable;
          note = `Rule check: ${comp.title}.`;
        } else if (cur && (ph.width !== cur.width || ph.height !== cur.height)) {
          status = 'no';
          note = `Different frame (${ph.width}x${ph.height} against ${cur.width}x${cur.height}), so the views do not line up.`;
        } else {
          const own = m.check && m.check.photoChecks && m.check.photoChecks[0] && m.check.photoChecks[0].findings.find((f) => f.key === 'comparable');
          if (own && own.comparable === 'no') {
            status = 'no';
            note = `Rule check for ${m.label}: ${own.title}.`;
          } else if (own && own.comparable === 'caution') {
            status = 'caution';
            note = `Rule check for ${m.label}: ${own.title}.`;
          }
        }
        return { period: m.period, label: m.label, url: ph.url, status, note };
      })
      .concat(S.pid === 'P-001' && cur && /source video clip/.test(cur.metadataSource || '') ? [FINISHED_LOOK()] : []);
  }
  function attachLens() {
    const st = $('#lensStage .stage');
    if (!st || !window.PoPLens) return;
    const months = lensMonths();
    if (S.lensPeriod === null) {
      const first = months.find((m) => !m.ai && m.period < S.period && m.status !== 'no') || months.find((m) => !m.ai && m.status !== 'no');
      S.lensPeriod = first ? first.period : '';
    }
    window.PoPLens.attach({ stage: st, picker: $('#lensPicker'), currentLabel: S.per.label, months, selected: S.lensPeriod, onChange: (p) => (S.lensPeriod = p) });
  }

  async function useNote() {
    const text = ($('#dnText').value || '').trim();
    if (!text) return setMsg($('#dnMsg'), 'Draft or type the note first.', 'err');
    const value = S.per.percentComplete ? S.per.percentComplete.value : $('#pctInput').value;
    if (value === '' || value == null) return setMsg($('#dnMsg'), 'Enter the percent complete above first.', 'err');
    try {
      await api(`/api/projects/${S.pid}/periods/${S.period}/percent`, { method: 'PUT', body: { value, narrative: text } });
      await refresh();
      setMsg($('#dnMsg'), 'Saved as the MPDO narrative. You still check and submit the report yourself.', 'ok');
    } catch (e) {
      setMsg($('#dnMsg'), e.message, 'err');
    }
  }

  await loadProjects();
  await refresh();
})();
