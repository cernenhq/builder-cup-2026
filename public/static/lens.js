// Comparison lens and swipe: move over the photo and see another month in the same spot (lens), or
// drag across it to reveal the other month from the left edge up to the pointer (swipe).
// Plain script, no modules. Exposes window.PoPLens.attach(opts).
// Each month's photo is already aligned to the latest view (same frame), so the lens shows the
// other month at the same position. When the rule checks say two views do not line up, the lens
// says "not comparable" and stays off for that month.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // opts: {
  //   stage: Element (the .stage holding the current photo and evidence boxes),
  //   picker: Element (where the month picker goes),
  //   currentLabel: 'May 2026',
  //   months: [{ period, label, url, status: 'yes'|'caution'|'no'|'aligned', note }],
  //   selected: period or '' (off),
  //   onChange: (period) => void
  // }
  function attach(opts) {
    const { stage, picker } = opts;
    if (!stage || !picker) return null;
    const months = opts.months || [];
    if (!months.length) {
      picker.innerHTML = '<p class="small" data-testid="lens-none">No other month has a photo to compare with yet.</p>';
      return null;
    }
    let selected = months.some((m) => m.period === opts.selected) ? opts.selected : '';
    picker.innerHTML = `<div class="lens-pick"><label>Compare like with like: see another month in the same spot
      <select data-testid="lens-month"><option value="">Lens off</option>${months
        .map((m) => `<option value="${esc(m.period)}" ${m.period === selected ? 'selected' : ''}>${esc(m.label)}${m.status === 'no' ? ' (not comparable)' : m.status === 'caution' ? ' (compare with caution)' : ''}</option>`)
        .join('')}</select></label>
      <span class="seg lens-mode" role="group" aria-label="Comparison mode"><button type="button" data-mode="lens" class="on" data-testid="mode-lens">Lens</button><button type="button" data-mode="swipe" data-testid="mode-swipe">Swipe</button></span>
      <div class="mini lens-status" data-testid="lens-status"></div></div>`;
    const sel = picker.querySelector('select');
    const status = picker.querySelector('.lens-status');

    const lens = document.createElement('div');
    lens.className = 'lens';
    lens.setAttribute('data-testid', 'lens');
    lens.setAttribute('aria-hidden', 'true');
    lens.innerHTML = '<span class="lens-tag"></span>';
    stage.appendChild(lens);
    const tag = lens.querySelector('.lens-tag');
    const preload = {};
    // Swipe: the other month covers the photo from the left edge up to the pointer, with a divider.
    const swipe = document.createElement('div');
    swipe.className = 'swipe';
    swipe.setAttribute('data-testid', 'swipe');
    swipe.setAttribute('aria-hidden', 'true');
    swipe.innerHTML = '<span class="swipe-line"></span><span class="lens-tag swipe-tag"></span>';
    stage.appendChild(swipe);
    const swipeTag = swipe.querySelector('.swipe-tag');
    let mode = 'lens';
    const modeBtns = picker.querySelectorAll('[data-mode]');

    function current() {
      return months.find((m) => m.period === selected) || null;
    }
    function update() {
      const m = current();
      stage.classList.remove('lens-on', 'lens-blocked');
      lens.classList.remove('show');
      swipe.classList.remove('show');
      stage.removeAttribute('data-lens-month');
      if (!m) {
        status.textContent = `Lens off. Pick a month, then move over the photo.`;
        return;
      }
      if (m.status === 'no') {
        stage.classList.add('lens-blocked');
        status.innerHTML = `<span class="chip lens-nc" data-testid="lens-not-comparable">Not comparable</span> ${esc(m.note || 'The views do not line up.')} The lens stays off for ${esc(m.label)}.`;
        return;
      }
      if (!preload[m.period]) {
        preload[m.period] = new Image();
        preload[m.period].src = m.url;
      }
      stage.classList.add('lens-on');
      stage.setAttribute('data-lens-month', m.period);
      lens.style.backgroundImage = `url("${m.url}")`;
      swipe.style.backgroundImage = `url("${m.url}")`;
      tag.textContent = m.label;
      swipeTag.textContent = `${m.label} | ${opts.currentLabel || 'this month'}`;
      const how = mode === 'swipe' ? `Drag across the photo: left of the line is ${esc(m.label)}, right of it is ${esc(opts.currentLabel || 'this month')}.` : `Move over the photo: the circle shows ${esc(m.label)} in the same spot as ${esc(opts.currentLabel || 'this month')}.`;
      status.innerHTML = `${m.status === 'caution' ? '<span class="chip lvl-1">Compare with caution</span> ' : ''}${how} ${esc(m.note || '')}`;
    }

    function move(clientX, clientY) {
      const m = current();
      if (!m || m.status === 'no') return;
      const r = stage.getBoundingClientRect();
      const x = clientX - r.left;
      const y = clientY - r.top;
      if (x < 0 || y < 0 || x > r.width || y > r.height) {
        lens.classList.remove('show');
        return;
      }
      if (mode === 'swipe') {
        const pct = Math.round((x / r.width) * 1000) / 10;
        swipe.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
        swipe.style.setProperty('--swipe-x', `${pct}%`);
        swipe.classList.add('show');
        return;
      }
      const d = Math.max(110, Math.min(220, Math.round(r.width * 0.3)));
      lens.style.width = `${d}px`;
      lens.style.height = `${d}px`;
      lens.style.left = `${x - d / 2}px`;
      lens.style.top = `${y - d / 2}px`;
      lens.style.backgroundSize = `${r.width}px ${r.height}px`;
      lens.style.backgroundPosition = `${-(x - d / 2)}px ${-(y - d / 2)}px`;
      lens.classList.add('show');
    }

    stage.addEventListener('pointermove', (e) => move(e.clientX, e.clientY));
    stage.addEventListener('pointerdown', (e) => move(e.clientX, e.clientY));
    stage.addEventListener('pointerleave', () => {
      lens.classList.remove('show');
      if (mode !== 'swipe') swipe.classList.remove('show');
    });
    modeBtns.forEach((b) =>
      b.addEventListener('click', () => {
        mode = b.dataset.mode;
        modeBtns.forEach((x) => x.classList.toggle('on', x === b));
        lens.classList.remove('show');
        swipe.classList.remove('show');
        update();
      })
    );
    sel.addEventListener('change', () => {
      selected = sel.value;
      update();
      if (opts.onChange) opts.onChange(selected);
    });
    update();
    return { lens, swipe, select: sel };
  }

  window.PoPLens = { attach };
})();
