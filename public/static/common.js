// Shared helpers for every page. No framework.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  async function api(path, opts = {}) {
    const o = { method: opts.method || 'GET', headers: { 'x-pop-request': '1' }, credentials: 'same-origin' };
    if (opts.form) o.body = opts.form;
    else if (opts.body !== undefined) {
      o.headers['content-type'] = 'application/json';
      o.body = JSON.stringify(opts.body);
    }
    const r = await fetch(path, o);
    let data = null;
    try {
      data = await r.json();
    } catch (e) {
      data = null;
    }
    if (!r.ok) {
      const err = new Error((data && data.error) || `Request failed (${r.status})`);
      err.status = r.status;
      err.data = data;
      err.needsCode = !!(data && data.needsCode);
      throw err;
    }
    return data;
  }

  const VL = { supported: 'Supported', contradicted: 'Contradicted', not_assessable: "Can't tell", disagree: 'Readers disagree', no_answer: 'No answer' };
  const chip = (v) => `<span class="chip v-${esc(v)}" data-verdict="${esc(v)}">${esc(VL[v] || v)}</span>`;
  const STATUS = { on_time: 'On time', late: 'Late: flagged, not counted', overdue: 'Overdue', due_soon: 'Due soon', upcoming: 'Upcoming' };
  const statusChip = (s) => `<span class="chip s-${esc(s)}">${esc(STATUS[s] || s)}</span>`;
  const fmtDate = (d) => {
    if (!d) return '';
    const t = new Date(d.length === 10 ? `${d}T00:00:00Z` : d);
    return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: d.length === 10 ? 'UTC' : undefined });
  };
  const fmtTime = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const monthLabel = (p) => {
    const [y, m] = p.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  };
  const setMsg = (el, text, kind) => {
    if (!el) return;
    el.textContent = text || '';
    el.className = `msg ${kind || ''}`;
  };

  let META = null;
  async function meta() {
    if (!META) META = await api('/api/meta');
    return META;
  }

  // Header with product name, brand, demo date, who is signed in.
  async function header(opts = {}) {
    const m = await meta();
    let me = null;
    if (opts.signedIn) {
      try {
        me = await api('/api/auth/me');
      } catch (e) {
        location.href = '/';
        return null;
      }
    }
    const top = document.createElement('div');
    top.innerHTML = `<header class="top"><div class="wrap"><div class="brand"><span class="pn">${esc(m.productName)}</span><span class="bd" data-testid="brand">${esc(m.brandDisplay)}</span></div>
      ${opts.subtitle ? `<span class="small" style="color:#bdb7aa">${esc(opts.subtitle)}</span>` : ''}
      <div class="who">${me ? `<span class="role" data-testid="role">${esc(me.role)}</span><span>${esc(me.name)}</span><button id="signout">Sign out</button>` : ''}</div></div></header>
      <div class="banner"><div class="wrap">${m.demoDate ? `Demo date: ${esc(fmtDate(m.today))}. ` : ''}All projects, progress claims and amounts here are fictional.${opts.signedIn ? `${m.aiMode === 'mock' ? ` Readers: <b>${esc(m.phrases.mockReader)}</b>.` : m.access && m.access.judge ? ` Readers: Gemini (${esc(m.model)}); live runs on with your judge access.` : ` Readers: Gemini (${esc(m.model)}), saved runs. <span data-testid="needs-code-note">Live runs need the judge access code (sign-in page).</span>`} ${esc(m.phrases.personDecides)}` : ''}${m.workspace && m.workspace.own ? ' Your changes stay in your own copy of the demo for 24 hours.' : ''}</div></div>`;
    document.body.prepend(top);
    const so = $('#signout');
    if (so)
      so.onclick = async () => {
        await api('/api/auth/logout', { method: 'POST' });
        location.href = '/';
      };
    return { meta: m, me };
  }

  // Draw evidence boxes over a photo. boxes: [{box:[ymin,xmin,ymax,xmax], verdict, label, id}]
  function stage(src, boxes) {
    return `<div class="stage"><img src="${esc(src)}" alt="Site photo">${(boxes || [])
      .map((b) => {
        const [y0, x0, y1, x1] = b.box;
        return `<div class="box ${esc(b.verdict)}" data-box="${esc(b.id)}" style="top:${y0 / 10}%;left:${x0 / 10}%;width:${(x1 - x0) / 10}%;height:${(y1 - y0) / 10}%"><span>${esc(b.label)}</span></div>`;
      })
      .join('')}</div>`;
  }

  function findings(list) {
    return list.map((f) => `<div class="find" data-check="${esc(f.key)}" data-level="${esc(f.level)}"><span class="dot ${esc(f.level)}"></span><div>${esc(f.title)}${f.detail ? `<div class="d">${esc(f.detail)}</div>` : ''}</div></div>`).join('');
  }

  window.PoP = { esc, $, $$, api, chip, statusChip, fmtDate, fmtTime, monthLabel, setMsg, meta, header, stage, findings, VL, STATUS };
})();
