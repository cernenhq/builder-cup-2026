// Comparison lens and swipe: move over the photo and see another month in the same spot (lens), or
// drag across it to reveal the other month from the left edge up to the pointer (swipe), or see a change map (red where pixels differ after evening out brightness).
// Plain script, no modules. Exposes window.PoPLens.attach(opts).
// Each month's photo is already aligned to the latest view (same frame), so the lens shows the
// other month at the same position. When the rule checks say two views do not line up, the lens
// says "not comparable" and stays off for that month.
(function () {
  const CHANGE_LEGEND = 'Red marks pixels that changed between the two months, after evening out brightness. Pixel change is not a verdict: lighting, weather and blur all change pixels.';
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
      <span class="seg lens-mode" role="group" aria-label="Comparison mode"><button type="button" data-mode="lens" class="on" data-testid="mode-lens">Lens</button><button type="button" data-mode="swipe" data-testid="mode-swipe">Swipe</button><button type="button" data-mode="change" data-testid="mode-change">Change map</button></span>
      <label class="change-ctl" hidden>Change threshold <input type="range" min="5" max="90" step="1" value="30" data-testid="change-thr"></label>
      <div class="mini lens-status" data-testid="lens-status"></div>
      <p class="mini change-legend" data-testid="change-legend" hidden>${esc(CHANGE_LEGEND)}</p></div>`;
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
    // Change map: a canvas over the photo, red where the two months differ after evening out brightness.
    const cmap = document.createElement('canvas');
    cmap.className = 'change-map';
    cmap.setAttribute('data-testid', 'change-canvas');
    cmap.setAttribute('aria-hidden', 'true');
    stage.appendChild(cmap);
    const thrCtl = picker.querySelector('.change-ctl');
    const thr = picker.querySelector('[data-testid="change-thr"]');
    const legend = picker.querySelector('.change-legend');
    const baseImg = stage.querySelector('img');
    const imgCache = {};
    let drawSeq = 0;
    function loadImage(url) {
      if (!imgCache[url]) {
        imgCache[url] = new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => res(im);
          im.onerror = () => rej(new Error('Could not load the photo.'));
          im.src = url;
        });
      }
      return imgCache[url];
    }
    // Luminance per pixel, shifted so each image's mean luminance is the same (zero).
    function lum(data, n) {
      const out = new Float32Array(n);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
        sum += out[i];
      }
      const mean = sum / (n || 1);
      for (let i = 0; i < n; i++) out[i] -= mean;
      return out;
    }
    async function drawChange(m) {
      const seq = ++drawSeq;
      const r = stage.getBoundingClientRect();
      const w = Math.max(1, Math.min(640, Math.round(r.width || 640)));
      const h = Math.max(1, Math.round(w * ((r.height || r.width * 0.56) / (r.width || 1))));
      let a, b;
      try {
        [a, b] = await Promise.all([loadImage(baseImg ? baseImg.currentSrc || baseImg.src : ''), loadImage(m.url)]);
      } catch (e) {
        if (seq === drawSeq) status.textContent = 'The change map could not load one of the photos.';
        return;
      }
      if (seq !== drawSeq || mode !== 'change') return;
      const work = document.createElement('canvas');
      work.width = w;
      work.height = h;
      const x = work.getContext('2d', { willReadFrequently: true });
      x.drawImage(a, 0, 0, w, h);
      const d1 = x.getImageData(0, 0, w, h).data;
      x.clearRect(0, 0, w, h);
      x.drawImage(b, 0, 0, w, h);
      const d2 = x.getImageData(0, 0, w, h).data;
      const n = w * h;
      const l1 = lum(d1, n);
      const l2 = lum(d2, n);
      const t = Number(thr.value) || 30;
      const out = x.createImageData(w, h);
      let changed = 0;
      for (let i = 0; i < n; i++) {
        const v = Math.abs(l1[i] - l2[i]);
        if (v > t) {
          changed++;
          out.data[i * 4] = 225;
          out.data[i * 4 + 1] = 40;
          out.data[i * 4 + 2] = 30;
          out.data[i * 4 + 3] = Math.min(190, 90 + (v - t) * 2);
        }
      }
      cmap.width = w;
      cmap.height = h;
      cmap.getContext('2d').putImageData(out, 0, 0);
      cmap.setAttribute('data-changed-share', String(Math.round((changed / (n || 1)) * 1000) / 10));
      cmap.classList.add('show');
    }

    function current() {
      return months.find((m) => m.period === selected) || null;
    }
    function update() {
      const m = current();
      stage.classList.remove('lens-on', 'lens-blocked');
      lens.classList.remove('show');
      swipe.classList.remove('show');
      cmap.classList.remove('show');
      drawSeq++;
      thrCtl.hidden = true;
      legend.hidden = true;
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
      if (mode === 'change') {
        thrCtl.hidden = false;
        legend.hidden = false;
        status.innerHTML = `${m.status === 'caution' ? '<span class="chip lvl-1">Compare with caution</span> ' : ''}Change map: ${esc(opts.currentLabel || 'this month')} against ${esc(m.label)}. Move the threshold to show only bigger changes. ${esc(m.note || '')}`;
        drawChange(m);
        return;
      }
      const how = mode === 'swipe' ? `Drag across the photo: left of the line is ${esc(m.label)}, right of it is ${esc(opts.currentLabel || 'this month')}.` : `Move over the photo: the circle shows ${esc(m.label)} in the same spot as ${esc(opts.currentLabel || 'this month')}.`;
      status.innerHTML = `${m.status === 'caution' ? '<span class="chip lvl-1">Compare with caution</span> ' : ''}${how} ${esc(m.note || '')}`;
    }

    function move(clientX, clientY) {
      const m = current();
      if (!m || m.status === 'no' || mode === 'change') return;
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
    thr.addEventListener('input', () => {
      const m = current();
      if (mode === 'change' && m && m.status !== 'no') drawChange(m);
    });
    sel.addEventListener('change', () => {
      selected = sel.value;
      update();
      if (opts.onChange) opts.onChange(selected);
    });
    update();
    return { lens, swipe, changeMap: cmap, select: sel };
  }

  window.PoPLens = { attach };
})();
