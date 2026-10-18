// Monday view, owner and lender block: the plan drawn onto the site camera's own view, the timeline,
// and the finish range checked with standard schedule formulas. Reads GET /api/owner/projects/:id/trajectory.
// If WebGL is not available, the photo and the numbers still show, with a plain note.
(function () {
  const CAVEAT = 'Hand-built demo model, fitted to the May 2026 camera view from six matched points. The schedule is fictional. Hidden work, like fit-out and services, is never shown as done or late: a photo cannot see it.';
  const LEGEND = [
    ['built', 'Built, as the photos show'],
    ['late', 'Planned by now, not visible'],
    ['progress', 'In progress'],
    ['planned', 'Still to come']
  ];
  const COL = { built: [0xf4f8ff, 0.85, 0], late: [0xff6b5b, 0.95, 0.28], progress: [0xffc857, 0.95, 0.24], planned: [0x7fe3f0, 0.5, 0.06], projected: [0xf4f8ff, 0.4, 0] };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const mlab = (period) => {
    const [y, m] = period.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  };
  const dlab = (date) => (date ? mlab(date.slice(0, 7)) : 'n/a');
  const monthIdx = (from, period) => {
    const [y0, m0] = from.split('-').map(Number);
    const [y, m] = period.split('-').map(Number);
    return (y - y0) * 12 + (m - m0);
  };
  const prevMonth = (date) => {
    let [y, m] = date.split('-').map(Number);
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
    return `${y}-${String(m).padStart(2, '0')}`;
  };
  // Fractional month index of an ISO date, relative to a base period (0 = first day of base month).
  const dateIdx = (base, date) => {
    const [y, m, d] = date.split('-').map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return monthIdx(base, `${y}-${String(m).padStart(2, '0')}`) + (d - 1) / dim;
  };

  let threeLoading = null;
  function loadThree() {
    if (window.THREE) return Promise.resolve(true);
    if (!threeLoading)
      threeLoading = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = PoP.url('/static/owner/three.min.js');
        s.onload = () => resolve(!!window.THREE);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
      });
    return threeLoading;
  }

  // ---------- element states (pure) ----------
  // t: model month index (0 = Jun 2025). ctx: { now, ev(t) -> line evidence, proj(e) -> projected month }.
  function lineRule(e, ev) {
    const s = e.line && ev ? ev[e.line] : null;
    if (!s || s.lastDecisionPct == null) return { kind: null, s };
    if (s.lastDecision === 'supported' && s.lastDecisionPct >= 100) return { kind: 'complete', s };
    if (s.lastDecision === 'contradicted' && s.lastDecisionPct >= 100) return { kind: 'notComplete', s };
    return { kind: null, s };
  }
  function makeStates(M, elems, ctx) {
    const fitBuilt = (e, tt) => e.fit != null && e.fit <= Math.min(tt, M.FIT_LAST);
    const fitStarted = (e, tt) => e.start != null && e.start <= Math.min(tt, M.FIT_LAST);
    const byLine = {};
    elems.forEach((e) => {
      if (e.line) (byLine[e.line] = byLine[e.line] || []).push(e);
    });
    function built(e, tt) {
      if (e.hidden) return false;
      const ev = ctx.ev(tt);
      const r = lineRule(e, ev);
      if (r.kind === 'complete') return true;
      let b = fitBuilt(e, tt);
      // The reviewer did not accept the line as complete: do not draw it complete.
      if (r.kind === 'notComplete' && b && byLine[e.line].every((x) => fitBuilt(x, tt))) {
        const ci = r.s.confirmedPeriod ? ctx.idx(r.s.confirmedPeriod) : -1;
        b = e.fit <= ci;
      }
      return b;
    }
    // In progress: work on this element was seen in the photos (the prototype's element-by-element reading).
    const started = (e, tt) => fitStarted(e, tt);
    return function stateAt(e, t) {
      if (e.hidden || !e.geo) return 'hidden';
      const now = ctx.now;
      const tt = Math.min(t, now);
      if (e.pair && !built(e.pair, tt) && !(t > now && ctx.proj(e.pair) <= t)) return 'none';
      if (e.temp) {
        if (built(e, tt) || (t > now && ctx.proj(e) <= t)) return 'none';
        return e.planned <= t ? 'late' : 'none';
      }
      if (built(e, tt)) return 'built';
      if (t > now && ctx.proj(e) <= t) return 'projected';
      if (started(e, tt)) return 'progress';
      return e.planned <= t ? 'late' : 'planned';
    };
  }

  // ---------- page block ----------
  async function mount(slot, projectId) {
    const api = window.PoP.api;
    let d;
    try {
      d = await api(`/api/owner/projects/${encodeURIComponent(projectId)}/trajectory`);
    } catch (e) {
      slot.innerHTML = `<div class="card section"><p class="small">The owner view could not load: ${esc(e.message)}</p></div>`;
      return;
    }
    const T = d.trajectory;
    const tl = d.timeline;
    const months = tl.months;
    const thisPeriod = prevMonth(d.today); // the reporting month that has just closed
    const latest = d.overlay.period;
    const startIdx = latest ? months.findIndex((m) => m.period === latest) : months.length - 1;
    const range = T.ok ? T.range : null;

    slot.innerHTML = `<div class="card section owner-card" data-testid="owner-view">
      <div class="owner-grid">
        <div class="owner-left">
          <div class="owner-stage" data-testid="owner-overlay">
            ${d.overlay.photo ? `<img id="ownImg" src="${esc(d.overlay.photo.url)}" alt="Site photo under the plan overlay">` : '<div class="owner-nophoto">No checked photo yet.</div>'}
            <canvas id="ownGl" aria-hidden="true"></canvas>
            <span class="owner-lab" id="ownLab"></span>
          </div>
          <div class="owner-legend" data-testid="owner-legend">${LEGEND.map(([k, t]) => `<span><i class="sw-${k}"></i>${esc(t)}</span>`).join('')}<span id="ownProjLeg" class="hide"><i class="sw-projected"></i>Done by then at this pace</span></div>
          <div class="owner-slider"><span>${esc(mlab(tl.from))}</span><input id="ownT" type="range" min="0" max="${months.length - 1}" step="1" value="${Math.max(0, startIdx)}" aria-label="Month"><span>${esc(mlab(tl.to))}</span></div>
          <p class="mini" id="ownCounts" data-testid="overlay-counts"></p>
          <p class="mini owner-note" id="ownNote" data-testid="overlay-note"></p>
        </div>
        <div class="owner-side">
          <div class="owner-eyebrow">The owner and lender view</div>
          <h2>The schedule, drawn onto the <em>camera's own view.</em></h2>
          <div class="owner-ann">At the pace reported so far</div>
          <div class="owner-proj" data-testid="finish-range">${range && range.text ? `Finish ${esc(range.text)}` : 'Not enough entries for a finish range yet.'}</div>
          ${T.ok
            ? `<p class="small">Planned finish ${esc(dlab(d.plannedFinish))} (fictional plan). The office's ${esc(mlab(T.latestPeriod))} figure is ${esc(T.actual)}% against ${esc(T.plannedNow)}% planned: slippage ${esc(T.slippage > 0 ? '+' : '')}${esc(T.slippage)} points, SPI ${esc(T.spi != null ? T.spi.toFixed(2) : 'n/a')}, time-based SPI ${esc(T.spiT != null ? T.spiT.toFixed(2) : 'n/a')}. ${esc(T.agree ? 'The methods agree.' : 'The methods disagree, so this is a range, not a date.')}</p>
               <p class="mini">Pace: the office's monthly percent complete and the milestone plan, through the standard methods listed below. Every input can be re-typed into a public calculator.</p>`
            : ''}
          <p class="small owner-caveat" data-testid="owner-caveat">${esc(CAVEAT)}</p>
        </div>
      </div>
      <div class="owner-chart" data-testid="owner-timeline">${chart(d, thisPeriod, startIdx)}</div>
      ${T.ok ? methodsTable(T) : ''}
    </div>`;

    const input = slot.querySelector('#ownT');
    const img = slot.querySelector('#ownImg');
    const lab = slot.querySelector('#ownLab');
    const counts = slot.querySelector('#ownCounts');
    const note = slot.querySelector('#ownNote');
    const cursor = slot.querySelector('#ownCursor');
    const canvas = slot.querySelector('#ownGl');
    const M = window.PoPModel;

    // Model month index for each timeline month.
    const base = M ? M.BASE_PERIOD : tl.from;
    const idx = (period) => monthIdx(base, period);
    const nowIdx = latest ? idx(latest) : -1;
    const evAt = (t) => {
      const per = months.find((m) => idx(m.period) === Math.min(t, nowIdx));
      return per ? per.lines : {};
    };

    let draw = null;
    let elems = null;
    let stateAt = null;
    if (d.overlay.hasModel && M && latest) {
      const ok = await loadThree();
      if (ok) {
        try {
          draw = setupGl(canvas, M);
        } catch (e) {
          draw = null;
        }
      }
      elems = draw ? draw.elems : null;
      if (elems) {
        // Projection: spread the work not yet built between the latest photo and the middle finish estimate.
        const midDate = T.ok ? (T.methods.find((m) => m.key === 'pert') || {}).result : null;
        const mid = midDate && midDate.finish ? dateIdx(base, midDate.finish) : nowIdx + 12;
        const open = elems.filter((e) => !e.hidden && e.geo);
        const maxPlanned = Math.max(...open.map((e) => e.planned));
        const stretch = (mid - nowIdx) / Math.max(1, maxPlanned - nowIdx);
        const projOf = new Map();
        stateAt = makeStates(M, elems, { now: nowIdx, ev: evAt, idx, proj: (e) => projOf.get(e) ?? Infinity });
        open.forEach((e) => {
          if (stateAt(e, nowIdx) === 'built') return;
          const b = Math.max(e.planned, nowIdx + 0.5);
          projOf.set(e, Math.ceil(nowIdx + (b - nowIdx) * stretch));
        });
      }
    }
    if (!draw) {
      canvas.classList.add('hide');
      note.textContent = d.overlay.hasModel
        ? 'The 3D plan could not be drawn in this browser. The photo and the schedule numbers below still show.'
        : 'No 3D model for this project. The photo and the schedule numbers still show.';
      note.dataset.fallback = 'yes';
    }

    function show(i) {
      const m = months[i];
      const t = idx(m.period);
      const future = t > nowIdx;
      if (img && m.photo) img.src = m.photo.url;
      else if (img && future && d.overlay.photo) img.src = d.overlay.photo.url;
      const tag = future ? `${mlab(m.period)}: projection, latest checked photo (${mlab(latest)}) shown` : m.photo && !m.photo.own ? `${mlab(m.period)}: no checked photo, ${mlab(m.photo.period)} shown` : `Site camera, ${mlab(m.period)}`;
      lab.textContent = tag;
      slot.querySelector('#ownProjLeg').classList.toggle('hide', !future);
      if (cursor) cursor.setAttribute('transform', `translate(${chartX(d, i)},0)`);
      if (draw && stateAt) {
        const c = { built: 0, late: 0, progress: 0, planned: 0, projected: 0 };
        const st = new Map();
        elems.forEach((e) => {
          const s = stateAt(e, t);
          st.set(e, s);
          if (s in c) c[s]++;
        });
        draw.render(st);
        counts.textContent = `${mlab(m.period)}, model elements: ${c.built} built, ${c.late} planned by now and not visible, ${c.progress} in progress, ${c.planned} still to come${future ? `, ${c.projected} done by then at this pace` : ''}. Hidden work is not drawn.`;
        if (!note.dataset.fallback)
          note.textContent = `Planned by now: each element's month in the demo model's fictional baseline, which ends at the plan's ${dlab(d.plannedFinish)} handover. Built: the reviewer's latest decision on each progress claim line (a line accepted as complete is drawn complete; one not accepted as complete is never drawn complete), placed element by element as the prototype read the photos through May 2026.`;
      } else {
        counts.textContent = `${mlab(m.period)}: planned ${m.planned}%${m.office != null ? `, office ${m.office}%` : ''}.`;
      }
    }
    input.oninput = () => show(+input.value);
    show(+input.value);
    if (draw) {
      const again = () => show(+input.value);
      if (window.ResizeObserver) new ResizeObserver(again).observe(canvas);
      else window.addEventListener('resize', again);
    }
  }

  function setupGl(canvas, M) {
    const THREE = window.THREE;
    const R = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    R.setClearColor(0x000000, 0);
    const S = new THREE.Scene();
    const C = new THREE.PerspectiveCamera(M.CAM.fov, 16 / 9, 1, 4000);
    C.position.set(...M.CAM.C);
    C.lookAt(...M.CAM.T);
    const elems = M.elements();
    const items = elems
      .filter((e) => e.geo)
      .map((e) => {
        const g = e.geo();
        const line = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }));
        const fill = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
        S.add(fill);
        S.add(line);
        return { e, line, fill };
      });
    function render(states) {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;
      R.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      R.setSize(w, h, false);
      C.aspect = w / h;
      C.updateProjectionMatrix();
      items.forEach(({ e, line, fill }) => {
        const c = COL[states.get(e)];
        line.visible = !!c;
        fill.visible = !!c && c[2] > 0;
        if (c) {
          line.material.color.setHex(c[0]);
          line.material.opacity = c[1];
          fill.material.color.setHex(c[0]);
          fill.material.opacity = c[2];
        }
      });
      R.render(S, C);
    }
    return { elems, render };
  }

  // ---------- timeline chart (SVG) ----------
  const W = 980;
  const H = 230;
  const PL = 44;
  const PR = 16;
  const PT = 16;
  const PB = 34;
  function chartX(d, i) {
    const n = d.timeline.months.length - 1;
    return PL + (i / Math.max(1, n)) * (W - PL - PR);
  }
  function chart(d, thisPeriod, startIdx) {
    const months = d.timeline.months;
    const from = d.timeline.from;
    const n = months.length - 1;
    const X = (fi) => PL + (fi / Math.max(1, n)) * (W - PL - PR);
    const Y = (v) => H - PB - (v / 100) * (H - PT - PB);
    // month-end position for a period = index + 1 (end of that month), clipped to the chart.
    const XE = (period) => X(Math.min(n, Math.max(0, monthIdx(from, period) + 1)));
    const XD = (date) => X(Math.min(n, Math.max(0, dateIdx(from, date))));
    let s = `<rect x="${PL}" y="${PT}" width="${W - PL - PR}" height="${H - PT - PB}" fill="none" class="c-frame"/>`;
    [0, 50, 100].forEach((v) => (s += `<line x1="${PL}" x2="${W - PR}" y1="${Y(v)}" y2="${Y(v)}" class="c-grid"/><text x="${PL - 6}" y="${Y(v) + 4}" text-anchor="end" class="c-txt">${v}%</text>`));
    const tp = months.findIndex((m) => m.period === thisPeriod);
    if (tp >= 0) s += `<rect x="${X(tp)}" y="${PT}" width="${Math.max(2, X(tp + 1) - X(tp))}" height="${H - PT - PB}" class="c-now"/><text x="${X(tp) + 4}" y="${PT + 12}" class="c-txt" data-testid="timeline-mark">${esc(mlab(thisPeriod))}: this period</text>`;
    months.forEach((m, i) => {
      if (i % 3 === 0) s += `<text x="${X(i)}" y="${H - PB + 16}" text-anchor="middle" class="c-txt">${esc(mlab(m.period).replace(' 20', " '"))}</text>`;
    });
    // plan
    const pp = d.plan.filter((p) => p.date >= `${from}-01`);
    const before = d.plan.filter((p) => p.date < `${from}-01`).pop();
    let path = '';
    if (before && pp.length) {
      const a = dateIdx(from, before.date);
      const b = dateIdx(from, pp[0].date);
      path += `M${X(0)} ${Y(before.pct + ((0 - a) / (b - a)) * (pp[0].pct - before.pct))}`;
    }
    pp.forEach((p) => (path += `${path ? 'L' : 'M'}${XD(p.date)} ${Y(p.pct)}`));
    path += `L${X(n)} ${Y(100)}`;
    s += `<path d="${path}" class="c-plan"/>`;
    // office points
    const pts = d.history.filter((h) => h.period >= from);
    if (pts.length) {
      s += `<path d="${pts.map((h, i) => `${i ? 'L' : 'M'}${XE(h.period)} ${Y(h.value)}`).join('')}" class="c-office"/>`;
      s += pts.map((h) => `<circle cx="${XE(h.period)}" cy="${Y(h.value)}" r="3.5" class="c-dot"><title>${esc(mlab(h.period))}: ${esc(h.value)}%</title></circle>`).join('');
    }
    // projection fan to the finish range
    const T = d.trajectory;
    if (T.ok && T.range.from && pts.length) {
      const last = pts[pts.length - 1];
      const x0 = XE(last.period);
      const y0 = Y(last.value);
      s += `<polygon points="${x0},${y0} ${XD(T.range.from)},${Y(100)} ${XD(T.range.to)},${Y(100)}" class="c-fan"/>`;
      const pert = T.methods.find((m) => m.key === 'pert');
      if (pert && pert.result) s += `<line x1="${x0}" y1="${y0}" x2="${XD(pert.result.finish)}" y2="${Y(100)}" class="c-proj"/>`;
      s += `<text x="${XD(T.range.to)}" y="${Y(100) - 6}" text-anchor="end" class="c-txt c-projtxt">at this pace: ${esc(T.range.text)}</text>`;
    }
    // marks: planned finish, this period, latest checked photo
    s += `<line x1="${XD(d.plannedFinish)}" x2="${XD(d.plannedFinish)}" y1="${PT}" y2="${H - PB}" class="c-mark"/><text x="${XD(d.plannedFinish) + 4}" y="${H - PB - 8}" class="c-txt">planned finish</text>`;
    s += `<g id="ownCursor" transform="translate(${X(Math.max(0, startIdx))},0)"><line x1="0" x2="0" y1="${PT}" y2="${H - PB}" class="c-cursor"/></g>`;
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Plan and office percent complete, ${esc(mlab(from))} to ${esc(mlab(d.timeline.to))}">${s}</svg>
      <div class="owner-legend small-legend"><span><i class="sw-plan"></i>Plan (milestones joined by straight lines)</span><span><i class="sw-office"></i>Office percent complete</span><span><i class="sw-fan"></i>At this pace (range across methods)</span></div>`;
  }

  function methodsTable(T) {
    const rows = T.methods
      .map((m) => `<tr data-method="${esc(m.key)}"><td>${esc(m.name)}</td><td><code>${esc(m.formula)}</code></td><td>${esc(m.inputsText)}</td><td><b>${esc(m.resultText)}</b></td><td>${m.check.url ? `<a href="${esc(m.check.url)}" target="_blank" rel="noopener noreferrer">${esc(m.check.label)}</a>` : esc(m.check.label)}</td></tr>`)
      .join('');
    return `<h3 class="section">How the finish range was worked out</h3>
      <div class="tablewrap" data-testid="trajectory-table"><table><tr><th>Measure</th><th>Formula</th><th>Inputs we used</th><th>Result</th><th>Check it</th></tr>${rows}</table></div>
      <p class="mini">${esc(T.note)} The range runs from the earliest to the latest of: earned schedule, and the pace of the last ${esc(T.windows.map((w) => w.window).join(', '))} entries. One month = 30.44 days. These numbers cover the office's percent complete, not costs; no cost measure comes from photos. The three-point estimate follows the PERT convention; it is not a measured probability.</p>`;
  }

  window.PoPOwner = { mount, makeStates, CAVEAT };
})();
