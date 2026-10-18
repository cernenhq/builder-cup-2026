// Guided tour ("Play the story"): about three minutes through the real pages, one caption at a time.
// The step index lives in sessionStorage ('pop_tour'), so the tour carries across page loads in this tab.
// Runs on every page. Any element with [data-tour-start] starts it; window.PoPTour.start() does the same.
(function () {
  if (window.PoPTour) return;
  const KEY = 'pop_tour';
  const baseMeta = document.querySelector('meta[name="pop-base"]');
  const base = window.PoP && typeof window.PoP.base === 'string' ? window.PoP.base : baseMeta ? baseMeta.content : '';
  const url = (p) => (window.PoP && window.PoP.url ? window.PoP.url(p) : typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !(base && (p === base || p.startsWith(`${base}/`))) ? base + p : p);

  // page: the data-page the step belongs on (null: any page). user/role: who to sign in as for it.
  // path: where "Go there" goes when no sign-in is needed. focus: an element to bring into view, if present.
  const STEPS = [
    { page: 'login', path: '/', signOut: true, where: 'the sign-in page', text: 'This is a reviewer workbench for whoever releases money against site photos. Everything here is public footage or fictional.' },
    { page: 'funder', role: 'funder', user: 'fund-grace', where: 'Grace Lim, owner or lender', focus: '[data-testid=funder-project]', text: 'The owner or lender sees where each project stands: percent complete against plan, what the office confirmed from photos, and the plan drawn over the camera view.' },
    { page: 'engineer', role: 'engineer', user: 'eng-ana', where: 'Ana Reyes, engineer in charge', focus: '[data-testid=check-card]', april: true, hint: 'Pick April 2026 in Reporting period.', text: "The engineer runs the check on April's claim. Rule checks first, with no AI: reuse, dates, view, and whether the photo appears online. Then two Gemini readers. One line is contradicted; the rest can't be seen from this camera." },
    { page: 'engineer', role: 'engineer', user: 'eng-ana', where: 'Ana Reyes, engineer in charge', focus: '[data-testid=line-results]', text: 'The engineer has the last word on every line; one click overrules the AI and the log keeps both. Under the photo: Lens, Swipe and Change map compare months in the same spot.' },
    { page: 'engineer', role: 'engineer', user: 'eng-ana', where: 'Ana Reyes, engineer in charge', focus: '[data-testid=percent-card]', text: 'Percent complete is entered once and fills the COA, DILG, IAS and MPDO drafts. Draft with Gemini writes a plain note from the decisions only. Nothing is sent.' },
    { page: 'reviewer', role: 'reviewer', user: 'rev-benita', where: 'Benita Cruz, office head', focus: '[data-testid=lagging]', text: "On Monday the office head sees what is slipping, the plan over this month's photo, and the finish date checked three ways." },
    { page: 'mayor', role: 'mayor', user: 'mayor', where: 'Mayor Lina Torres', focus: '[data-testid=escalations]', text: 'The mayor sees only what has escalated.' },
    { page: 'public', path: '/public', where: 'the public page', focus: '[data-testid=public-note]', text: 'Residents get a plain note with no verdicts and no names, also in Filipino.' },
    { page: 'evidence', path: '/evidence', where: 'the evidence page', text: 'Every number on the deck comes from a run on this app.' },
    { page: null, text: 'It never approves, holds or releases a payment. A person decides every line.' }
  ];

  function read() {
    try {
      const v = window.sessionStorage.getItem(KEY);
      if (v == null) return null;
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : null;
    } catch (e) {
      return null;
    }
  }
  function write(n) {
    try {
      if (n == null) window.sessionStorage.removeItem(KEY);
      else window.sessionStorage.setItem(KEY, String(n));
    } catch (e) {
      /* storage blocked: the tour still works on this page */
    }
  }

  let current = null; // step index while the card is shown
  let memo = null; // fallback when storage is blocked
  let card = null;
  let watcher = null;

  const here = () => (document.body && document.body.dataset.page) || '';
  const onPage = (s) => !s.page || s.page === here();

  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }

  function stopWatch() {
    if (watcher) {
      watcher.obs.disconnect();
      clearTimeout(watcher.timer);
      watcher = null;
    }
  }

  // Pages draw themselves after their data loads, so wait briefly for the element; never fail if it is missing.
  function bringIntoView(sel) {
    stopWatch();
    if (!sel) return;
    const go = () => {
      const t = document.querySelector(sel);
      if (!t) return false;
      try {
        t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        /* ignore */
      }
      return true;
    };
    if (go()) return;
    const obs = new MutationObserver(() => {
      if (go()) stopWatch();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    watcher = { obs, timer: setTimeout(stopWatch, 8000) };
  }

  async function goThere(s, btn, msg) {
    btn.disabled = true;
    msg.textContent = '';
    try {
      if (s.user) {
        const r = await fetch(url('/api/auth/login'), { method: 'POST', credentials: 'same-origin', headers: { 'x-pop-request': '1', 'content-type': 'application/json' }, body: JSON.stringify({ userId: s.user }) });
        if (!r.ok) throw new Error(`Sign-in did not work (${r.status}).`);
        location.href = url(`/${s.role}`);
        return;
      }
      if (s.signOut) {
        await fetch(url('/api/auth/logout'), { method: 'POST', credentials: 'same-origin', headers: { 'x-pop-request': '1' } }).catch(() => null);
      }
      location.href = url(s.path || '/');
    } catch (e) {
      btn.disabled = false;
      msg.textContent = e.message || 'That did not work. Try again.';
    }
  }

  function pickApril(btn) {
    const sel = document.getElementById('periodSel');
    if (!sel || ![...sel.options].some((o) => o.value === '2026-04')) {
      btn.textContent = 'April 2026 is not on this project';
      btn.disabled = true;
      return;
    }
    sel.value = '2026-04';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    bringIntoView('[data-testid=check-card]');
  }

  function render() {
    stopWatch();
    if (current == null) {
      if (card) card.remove();
      card = null;
      document.documentElement.classList.remove('pop-tour-on');
      return;
    }
    const s = STEPS[current];
    const total = STEPS.length;
    const last = current === total - 1;
    const there = onPage(s);
    if (!card) {
      card = el('section', { class: 'tour-card', 'data-testid': 'tour-card', role: 'region', 'aria-label': 'Guided tour' });
      document.body.appendChild(card);
    }
    document.documentElement.classList.add('pop-tour-on');
    card.dataset.step = String(current + 1);
    card.dataset.onPage = there ? '1' : '0';
    card.textContent = '';

    const head = el('div', { class: 'tour-head' });
    head.appendChild(el('span', { class: 'tour-count', 'data-testid': 'tour-step' }, `Step ${current + 1} of ${total}`));
    head.appendChild(el('span', { class: 'tour-title' }, 'Play the story'));
    card.appendChild(head);
    card.appendChild(el('p', { class: 'tour-text', 'data-testid': 'tour-text', 'aria-live': 'polite' }, s.text));

    const msg = el('span', { class: 'tour-msg', role: 'status' });
    if (!there) {
      card.appendChild(el('p', { class: 'tour-where' }, `This step is on ${s.where}.`));
    } else if (s.hint) {
      card.appendChild(el('p', { class: 'tour-where' }, s.hint));
    }

    const row = el('div', { class: 'tour-row' });
    const back = el('button', { type: 'button', class: 'tour-back', 'data-testid': 'tour-back' }, 'Back');
    back.disabled = current === 0;
    back.addEventListener('click', () => move(-1));
    row.appendChild(back);
    if (!there) {
      const go = el('button', { type: 'button', class: 'tour-go primary', 'data-testid': 'tour-go' }, 'Go there');
      go.addEventListener('click', () => goThere(s, go, msg));
      row.appendChild(go);
    } else if (s.april) {
      const ap = el('button', { type: 'button', class: 'tour-april', 'data-testid': 'tour-april' }, 'Show April 2026');
      ap.addEventListener('click', () => pickApril(ap));
      row.appendChild(ap);
    }
    const next = el('button', { type: 'button', class: `tour-next${there ? ' primary' : ''}`, 'data-testid': 'tour-next' }, last ? 'Finish' : 'Next');
    next.addEventListener('click', () => (last ? end() : move(1)));
    row.appendChild(next);
    const stop = el('button', { type: 'button', class: 'tour-end', 'data-testid': 'tour-end' }, 'End tour');
    stop.addEventListener('click', end);
    row.appendChild(stop);
    row.appendChild(msg);
    card.appendChild(row);

    if (there) bringIntoView(s.focus);
  }

  function set(n) {
    current = n;
    memo = n;
    write(n);
    render();
  }
  function move(d) {
    if (current == null) return;
    set(Math.max(0, Math.min(STEPS.length - 1, current + d)));
  }
  function start() {
    set(0);
    const b = card && card.querySelector('.tour-next, .tour-go');
    if (b) b.focus();
  }
  function end() {
    current = null;
    memo = null;
    write(null);
    render();
  }

  function boot() {
    document.addEventListener('click', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('[data-tour-start]') : null;
      if (!t) return;
      e.preventDefault();
      start();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && current != null) end();
    });
    const n = read();
    if (n != null) {
      current = n;
      render();
    }
  }

  window.PoPTour = { start, end, next: () => move(1), back: () => move(-1), step: () => (current == null ? memo : current), steps: STEPS.length };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
