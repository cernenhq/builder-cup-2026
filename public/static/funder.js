// Owner and lender view: read only. Where the money's progress stands, from what a person decided.
(async function () {
  const { esc, $, api, header, fmtDate, stage } = window.PoP;
  const h = await header({ signedIn: true, subtitle: 'Owner and lender view' });
  if (!h) return;
  const main = $('#main');
  const o = await api('/api/funder/overview');
  const pct = (v) => (v === null || v === undefined ? 'n/a' : `${esc(v)}%`);
  const peso = (n) => `\u20b1${!n ? '0' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.round(n / 1e3) + 'k'}`;
  const DEC = { supported: 'Supported', contradicted: 'Contradicted', not_assessable: "Can't tell", waiting: 'Waiting for a person' };
  const decOf = (l) => l.decision || 'waiting';

  // 1. Statement lines against the photos: the last two checked months, one chip per claimed line.
  const linesPanel = (ov) => {
    const ms = ov.months.slice(-2).reverse();
    return `<div class="ov-panel" data-testid="ov-lines"><h3>Statement lines against the photos</h3>${ms
      .map((m) => `<div class="ov-row"><span class="ov-mon">${esc(m.label)}</span><span>${m.lines.map((l) => `<span class="chip v-${esc(decOf(l) === 'waiting' ? 'disagree' : decOf(l))}" title="${esc(l.label)}: ${esc(DEC[decOf(l)])}">${esc(l.label.replace(/\s*\(.*\)$/, ''))}</span>`).join(' ')}</span></div>`)
      .join('')}<p class="mini">What a person in the office decided for each claimed line. "Can't tell" means the camera cannot see it.</p></div>`;
  };

  // 2. The progress claim, split by what the photos show (claimed value of each checked line, fictional).
  const splitPanel = (ov) => {
    const m = ov.months[ov.months.length - 1];
    if (!m || !ov.contractAmount) return '';
    const w = Object.fromEntries(ov.lines.map((l) => [l.key, l.weight]));
    const sum = { contradicted: 0, waiting: 0, not_assessable: 0, supported: 0 };
    for (const l of m.lines) sum[decOf(l)] += (ov.contractAmount * (w[l.key] || 0) * (Number(l.claimedPct) || 0)) / 10000;
    const tot = Object.values(sum).reduce((a, b) => a + b, 0) || 1;
    const seg = (k, cls) => (sum[k] ? `<span class="ov-seg ${cls}" style="width:${((sum[k] / tot) * 100).toFixed(1)}%" title="${esc(DEC[k])}: ${peso(sum[k])}"></span>` : '');
    return `<div class="ov-panel" data-testid="ov-split"><h3>${esc(m.label)} progress claim, split by what the photos show</h3>
      <div><span class="ov-big" data-testid="ov-contradicted">${peso(sum.contradicted)}</span> <span class="small">on contradicted lines · fictional</span></div>
      <div class="ov-bar">${seg('contradicted', 'c-con')}${seg('waiting', 'c-dis')}${seg('not_assessable', 'c-na')}${seg('supported', 'c-sup')}</div>
      <div class="mini ov-legend"><span><i class="c-con"></i>${peso(sum.contradicted)} contradicted</span><span><i class="c-dis"></i>${peso(sum.waiting)} waiting for a person</span><span><i class="c-na"></i>${peso(sum.not_assessable)} can't tell</span><span><i class="c-sup"></i>${peso(sum.supported)} supported</span></div>
      <p class="mini">Claimed value of each checked line: contract amount × the line's share × the percent claimed. Shown for review; nothing is held or released.</p></div>`;
  };

  // 3. Photo checks, month by month: the rule checks (no AI) on each month's photo.
  const rulesPanel = (ov) => {
    const n = ov.months.reduce((k, m) => k + Object.values(m.rules).filter((r) => r.level === 'flag').length, 0);
    return `<div class="ov-panel" data-testid="ov-rules"><h3>Photo checks, month by month${n ? ` · ${n} to look at` : ''}</h3><div class="ov-scroll"><table class="ov-grid"><thead><tr><th></th>${ov.months.map((m) => `<th>${esc(m.label.slice(0, 3))}<br>${esc(m.period.slice(2, 4))}</th>`).join('')}</tr></thead><tbody>${ov.rules
      .map((r) => `<tr><th scope="row">${esc(r.label)}</th>${ov.months.map((m) => { const x = m.rules[r.key]; return `<td>${x ? `<span class="dot ${esc(x.level)}" title="${esc(m.label)}: ${esc(x.title)}"></span>` : '<span class="ov-none" title="not run">·</span>'}</td>`; }).join('')}</tr>`)
      .join('')}</tbody></table></div><p class="mini"><span class="dot ok ov-i"></span> passed <span class="dot flag ov-i"></span> look at it (a flag, not proof) <span class="dot info ov-i"></span> noted or not run</p></div>`;
  };

  // 4. Where to send an inspector: numbered pins on the latest checked photo.
  const inspectPanel = (ov) => {
    if (!ov.inspectPeriod || !ov.inspect.length) return '';
    const pins = ov.inspect.map((x, i) => (x.pin ? `<span class="ov-pin" style="top:${x.pin.y}%;left:${x.pin.x}%" data-testid="ov-pin">${i + 1}</span>` : '')).join('');
    return `<div class="ov-panel" data-testid="ov-inspect"><h3>Where to send an inspector, ${esc(ov.inspectPeriod.label)}</h3>
      ${ov.inspectPeriod.photoId ? `<div class="stage ov-stage"><img src="${esc(PoP.url('/api/photos/' + ov.inspectPeriod.photoId))}" alt="Site photo, ${esc(ov.inspectPeriod.label)}">${pins}</div>` : ''}
      <ol class="ov-list">${ov.inspect.map((x) => `<li><b>${esc(x.label)}</b> <span class="chip v-${esc(x.decision || 'disagree')}">${esc(DEC[x.decision || 'waiting'])}</span><div class="small">${esc(x.why)}${x.pin ? '' : ' No pin: not in the photo.'}</div></li>`).join('')}</ol></div>`;
  };

  // 5. By trade, as the photos show it: each line across the checked months.
  const tradePanel = (ov) => {
    const shown = ov.lines.filter((l) => !l.hidden);
    const hidden = ov.lines.filter((l) => l.hidden);
    const cell = (m, l) => {
      const x = m.lines.find((y) => y.key === l.key);
      if (!x) return '<span class="ov-cell c-none" title="Not claimed that month"></span>';
      const d = decOf(x);
      const cls = d === 'supported' ? (Number(x.claimedPct) >= 100 ? 'c-sup' : 'c-dis') : d === 'contradicted' ? 'c-con' : d === 'not_assessable' ? 'c-na' : 'c-wait';
      return `<span class="ov-cell ${cls}" title="${esc(m.label)}: claimed ${esc(x.claimedPct)}%, ${esc(DEC[d])}"></span>`;
    };
    return `<div class="ov-panel ov-wide" data-testid="ov-trade"><h3>By trade, as the photos show it</h3><div class="ov-scroll"><table class="ov-trade"><thead><tr><th></th>${ov.months.map((m) => `<th>${esc(m.label.slice(0, 3))}</th>`).join('')}</tr></thead><tbody>${shown
      .map((l) => `<tr><th scope="row">${esc(l.label)}</th>${ov.months.map((m) => `<td>${cell(m, l)}</td>`).join('')}</tr>`)
      .join('')}${hidden.length ? `<tr><th scope="row">${esc(hidden.map((l) => l.label).join('; '))}</th><td colspan="${ov.months.length}" class="small">Not visible from any photo. Send an inspector or ask for interior photos.</td></tr>` : ''}</tbody></table></div>
      <p class="mini ov-legend"><span><i class="c-sup"></i>visible, done</span><span><i class="c-dis"></i>visible, in progress</span><span><i class="c-con"></i>claimed, the photo shows otherwise</span><span><i class="c-na"></i>can't tell</span><span><i class="c-wait"></i>waiting for a person</span><span><i class="c-none"></i>not claimed that month</span></p></div>`;
  };
  const overview = (p) => (p.overview && p.overview.months.length ? `<div class="ov section" data-testid="funder-overview">${linesPanel(p.overview)}${splitPanel(p.overview)}${rulesPanel(p.overview)}${inspectPanel(p.overview)}${tradePanel(p.overview)}</div>` : '');

  // 6. Who uses it, and for what: one ring segment per person in the demo.
  const ROLES = [
    { k: 'funder', t: 'Owner or lender', s: 'Owner', d: 'Sees where the work stands before releasing money: percent complete, what the photos confirmed, what is open. Decides payment; the app never does.' },
    { k: 'mayor', t: 'LGU official', s: 'LGU', d: 'Sees only what has escalated, in plain words.' },
    { k: 'engineer', t: 'Engineer in charge', s: 'Engineer', d: 'Uploads the month\'s photos, runs the check, decides each line, and makes the COA, DILG, IAS and MPDO drafts.' },
    { k: 'reviewer', t: 'Office head', s: 'Office head', d: 'Monday view of what is slipping; overrules a verdict with a reason.' },
    { k: 'auditor', t: 'Auditor (COA, IAS, DILG)', s: 'Auditor', d: 'Reads the decision and submission logs. Read only.' },
    { k: 'public', t: 'The public', s: 'Public', d: 'A plain progress note with no verdict labels and no staff names, also in Filipino.' }
  ];
  const ring = () => {
    const R = 120, r = 70, cx = 150, cy = 150, n = ROLES.length;
    const pt = (rad, a) => `${(cx + rad * Math.sin(a)).toFixed(1)},${(cy - rad * Math.cos(a)).toFixed(1)}`;
    const segs = ROLES.map((x, i) => {
      const a0 = (i / n) * 2 * Math.PI + 0.02, a1 = ((i + 1) / n) * 2 * Math.PI - 0.02, am = (a0 + a1) / 2;
      const [lx, ly] = pt((R + r) / 2, am).split(',');
      return `<g class="ov-seg-g${i === 0 ? ' on' : ''}" data-role="${esc(x.k)}" tabindex="0" role="button" aria-label="${esc(x.t)}"><path class="ov-ring r${i}" d="M${pt(R, a0)} A${R},${R} 0 0 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 0 0 ${pt(r, a0)} Z"/><text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle">${esc(x.s)}</text></g>`;
    }).join('');
    return `<div class="card section ov-who" data-testid="ov-who"><h2>Who uses it, and for what</h2><p class="small">Pick a person to see what they get.</p><div class="ov-who-row"><svg viewBox="0 0 300 300" width="260" height="260" role="group" aria-label="People who use the app">${segs}<text x="150" y="146" text-anchor="middle" class="ov-core">One record</text><text x="150" y="164" text-anchor="middle" class="ov-core-s">photos · decisions · reports</text></svg><div class="ov-who-text" data-testid="ov-who-text" aria-live="polite"><b>${esc(ROLES[0].t)}</b><p>${esc(ROLES[0].d)}</p></div></div></div>`;
  };

  const card = (p) => {
    const c = p.latestChecked;
    const slip = p.slippage ? `planned ${esc(p.slippage.planned)}% for that date, so ${p.slippage.points > 0 ? '+' : ''}${esc(p.slippage.points)} points` : '';
    return `<div class="card section" data-testid="funder-project" data-pid="${esc(p.id)}">
      <h2>${esc(p.name)}</h2><div class="small">${esc(p.contractor)} · ${esc(p.location)}${p.fictional ? ' · demo, figures fictional' : ''}</div>
      <div class="row section"><div><div class="small">Office percent complete</div><div class="big">${p.percent ? pct(p.percent.value) : 'none yet'}</div><div class="small">${p.percent ? `as of ${esc(fmtDate(p.percent.asOf))}` : ''}${slip ? ` · ${slip}` : ''}</div></div></div>
      ${c ? `<p data-testid="funder-counts"><b>${esc(c.label)}, checked against site photos:</b> ${c.counts.supported} supported, ${c.counts.contradicted} contradicted, ${c.counts.not_assessable} can't tell${c.counts.waiting ? `, ${c.counts.waiting} waiting for a person` : ''}${c.stale ? ' <span class="chip lvl-1">photos or claims changed since the check</span>' : ''}.</p>` : '<p class="small">No month checked against photos yet.</p>'}
      ${p.overdueMilestones.length || p.overdueReports.length ? `<ul class="small">${p.overdueMilestones.map((m) => `<li>${esc(m.pct)}% milestone was planned for ${esc(fmtDate(m.due))}</li>`).join('')}${p.overdueReports.map((r) => `<li>Overdue report: ${esc(r)}</li>`).join('')}</ul>` : ''}
      <p class="small"><a href="${esc(window.PoP.base)}/public/${esc(p.id)}">Public progress note</a></p>
      ${overview(p)}
      ${p.photosByMonth && p.photosByMonth.length ? `<div class="section" data-testid="funder-compare"><h3>Compare months on the site photo</h3><div id="cmp-stage-${esc(p.id)}">${stage(PoP.url('/api/photos/' + p.photosByMonth[0].photoId), [])}</div><div id="cmp-pick-${esc(p.id)}" class="section"></div><p class="mini">${esc(p.photosByMonth[0].label)} photo. Lens, Swipe and Change map show another month in the same spot. The demo frames come from one fixed camera, aligned to the same view.</p></div>` : ''}
      ${c ? `<div class="section card" data-testid="owner-report"><h3>Owner report, ${esc(c.label)}</h3><p class="small">Drafted with Gemini from what a person in the office decided, nothing else. Edit it, print it or save it as PDF. It decides nothing about payment and is not sent anywhere.</p><p><button type="button" class="btn primary" data-draft="${esc(p.id)}|${esc(c.period)}" data-testid="owner-draft">Draft the owner report with Gemini</button> <button type="button" class="btn" data-print data-testid="owner-print">Print or save as PDF</button> <span class="small" id="dmsg-${esc(p.id)}"></span></p><textarea id="dtext-${esc(p.id)}" rows="7" style="width:100%" aria-label="Owner report draft" placeholder="The draft appears here."></textarea></div>` : ''}
      ${p.hasOverlay ? '<div data-testid="funder-overlay" id="ov-' + esc(p.id) + '"></div>' : ''}
    </div>`;
  };
  main.innerHTML = `<section class="section"><h1>Where the work stands</h1><p class="small">${esc(o.note)} "Can't tell" means the camera cannot see it, not that the work is missing.</p></section>${o.projects.map(card).join('')}${ring()}`;
  const whoText = main.querySelector('[data-testid="ov-who-text"]');
  const pickRole = (g) => {
    const x = ROLES.find((y) => y.k === g.dataset.role);
    main.querySelectorAll('.ov-seg-g').forEach((e) => e.classList.toggle('on', e === g));
    whoText.innerHTML = `<b>${esc(x.t)}</b><p>${esc(x.d)}</p>`;
  };
  main.querySelectorAll('.ov-seg-g').forEach((g) => {
    g.addEventListener('click', () => pickRole(g));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRole(g); } });
  });
  for (const p of o.projects.filter((x) => x.photosByMonth && x.photosByMonth.length > 1 && window.PoPLens)) {
    const st = document.querySelector(`#cmp-stage-${p.id} .stage`);
    const months = p.photosByMonth.slice(1).map((m) => ({ period: m.period, label: m.label, url: PoP.url('/api/photos/' + m.photoId), status: 'aligned', note: 'Prepared demo frames, aligned to the same view.' }));
    // The saved AI illustration of the finished building, made once: Lens and Swipe on it cost nothing.
    if (p.id === 'P-001') months.push({ period: 'ai-finished', label: 'AI finished look (illustration)', url: PoP.url('/static/finished-look.jpg'), status: 'aligned', ai: true, note: 'Made once by Gemini 3.1 Flash Image from the April 2026 frame; an illustration, not evidence and not the design.' });
    window.PoPLens.attach({ stage: st, picker: document.getElementById(`cmp-pick-${p.id}`), currentLabel: p.photosByMonth[0].label, months, selected: months.filter((m) => !m.ai).slice(-1)[0].period });
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
