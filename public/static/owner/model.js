// Hand-built demo model of the P-001 building, ported from the N1 prototype (model.js, 17 Oct).
// Geometry fitted to the May 2026 camera view from six matched points (least squares). Units: metres.
// It is a demo model, not a design file. The element schedule (PLAN) is the prototype's fictional
// baseline; its handover month (Dec 2026) is the same as P-001's 100% milestone.
// "fit" months are the prototype's own reading of the photos, element by element (0 = Jun 2025).
// Needs window.THREE only when build() is called.
(function () {
  const GEO = { L: 67.6, D: 40.86, R: 16, FL: 4, NF: 7, HR: 6.3, SB: 1.0 };
  const CAM = { C: [-146.88, 55.37, 160.42], T: [32.21, 18.57, -13.66], fov: 13.54 };
  const BASE_PERIOD = '2025-06'; // month index 0
  const FIT_LAST = 11; // the prototype read the photos up to May 2026

  const TRADES = {
    structure: 'Structure (slabs)',
    facade: 'Curtain-wall glazing',
    roofframe: 'Rooftop steel frame',
    roofdeck: 'Rooftop roof deck',
    enclosure: 'Rooftop enclosure walls',
    cladding: 'Rooftop cladding (final finish)',
    canopy: 'Entrance canopy',
    temp: 'Temporary works',
    finishes: 'Plaza and signage',
    hidden: 'Hidden work (fit-out, services, waterproofing)'
  };
  // Planned month per group (fictional baseline, month index from Jun 2025).
  const PLAN = { structure: 0, facadeRight: 2, facadeCurve: 3, roofframe: 0, roofdeck: 4, enclosure: 9, cladding: 13, canopy: 8, craneOut: 4, hoardingOut: 17, plaza: 16, signage: 16, fitout: 14, mep: 15, waterproof: 10 };

  const PER = (() => {
    const a = GEO.D - GEO.R;
    const b = (Math.PI * GEO.R) / 2;
    const c = GEO.L - GEO.R;
    return { a, b, c, total: a + b + c };
  })();
  function perim(s, off = 0) {
    const { D, R } = GEO;
    if (s <= PER.a) return { x: off, z: -D + s, nx: -1, nz: 0, zone: 'curve' };
    if (s <= PER.a + PER.b) {
      const th = Math.PI - ((s - PER.a) / PER.b) * (Math.PI / 2);
      return { x: R + (R - off) * Math.cos(th), z: -R + (R - off) * Math.sin(th), nx: Math.cos(th), nz: Math.sin(th), zone: 'curve' };
    }
    const t = s - PER.a - PER.b;
    return { x: R + t, z: -off, nx: 0, nz: 1, zone: 'right' };
  }
  function footprintShape(off = 0) {
    const THREE = window.THREE;
    const sh = new THREE.Shape();
    const { L, D, R } = GEO;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const p = perim(PER.a + (PER.b * i) / 24, off);
      pts.push([p.x, p.z]);
    }
    sh.moveTo(off, D - off);
    sh.lineTo(off, R);
    pts.forEach(([x, z]) => sh.lineTo(x, -z));
    sh.lineTo(L - off, off);
    sh.lineTo(L - off, D - off);
    sh.lineTo(off, D - off);
    return sh;
  }
  function bays() {
    const out = [];
    [[0, PER.a, 8], [PER.a, PER.a + PER.b, 8], [PER.a + PER.b, PER.total, 16]].forEach(([s0, s1, n]) => {
      for (let i = 0; i < n; i++) out.push([s0 + ((s1 - s0) * i) / n, s0 + ((s1 - s0) * (i + 1)) / n]);
    });
    return out;
  }
  function quad(p0, p1, y0, y1, out = 0.12) {
    const THREE = window.THREE;
    const g = new THREE.BufferGeometry();
    const a = [p0.x + p0.nx * out, y0, p0.z + p0.nz * out];
    const b = [p1.x + p1.nx * out, y0, p1.z + p1.nz * out];
    const c = [p1.x + p1.nx * out, y1, p1.z + p1.nz * out];
    const d = [p0.x + p0.nx * out, y1, p0.z + p0.nz * out];
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    g.computeVertexNormals();
    return g;
  }
  function box(w, h, d, x, y, z) {
    const g = new window.THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  }
  function slab(off, y, depth) {
    const g = new window.THREE.ExtrudeGeometry(footprintShape(off), { depth, bevelEnabled: false, curveSegments: 24 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  }

  // Element list. line = the P-001 progress claim line the element belongs to (null if none).
  // fit = month the prototype first saw it built in the photos; start = month work was first seen.
  function elements() {
    const E = [];
    const add = (o) => {
      o.id = `e${E.length}`;
      E.push(o);
      return o;
    };
    const { FL, NF, HR, SB } = GEO;
    const top = FL * NF;
    for (let k = 0; k <= NF; k++) add({ trade: 'structure', grp: 'structure', name: `Slab, level ${k}`, line: null, fit: 0, geo: () => slab(0.3, k * FL - 0.35, 0.35) });
    bays().forEach(([s0, s1], bi) => {
      const p0 = perim(s0);
      const p1 = perim(s1);
      const zone = perim((s0 + s1) / 2).zone;
      for (let f = 0; f < NF; f++) {
        let fit;
        if (zone === 'right') fit = f <= 2 ? 2 : 3;
        else fit = f <= 1 ? 2 : f <= 3 ? 3 : 4;
        if (zone !== 'right' && f === 0 && bi === 12) fit = 5; // the open bay on the lower curved front, still open in Oct 2025
        add({ trade: 'facade', grp: zone === 'right' ? 'facadeRight' : 'facadeCurve', name: `Glazing, ${zone === 'right' ? 'right wing' : 'curved front'}, floor ${f + 1}, bay ${bi + 1}`, line: zone === 'right' ? 'gr' : 'gc', start: 1, fit, geo: () => quad(p0, p1, f * FL + 0.1, (f + 1) * FL - 0.05) });
      }
    });
    bays().forEach(([s0], bi) => {
      const p = perim(s0, SB);
      add({ trade: 'roofframe', grp: 'roofframe', name: `Rooftop column ${bi + 1}`, line: 'rs', fit: 0, geo: () => box(0.35, HR, 0.35, p.x, top + HR / 2, p.z) });
    });
    add({ trade: 'roofdeck', grp: 'roofdeck', name: 'Rooftop roof deck', line: null, fit: 4, geo: () => slab(SB, top + HR - 0.45, 0.45) });
    bays().forEach(([s0, s1], bi) => {
      const p0 = perim(s0, SB);
      const p1 = perim(s1, SB);
      let fit = null;
      let start = null;
      if (bi >= 9 && bi <= 14) {
        fit = 10;
        start = 9;
      } else if ((bi >= 6 && bi <= 8) || (bi >= 15 && bi <= 19)) {
        fit = 11;
        start = 10;
      } else if (bi >= 20) start = 11;
      const enc = add({ trade: 'enclosure', grp: 'enclosure', name: `Rooftop enclosure wall, bay ${bi + 1}`, line: 're', start, fit, geo: () => quad(p0, p1, top + 0.3, top + HR - 0.6, -0.05) });
      add({ trade: 'cladding', grp: 'cladding', name: `Rooftop cladding, bay ${bi + 1}`, line: null, fit: null, pair: enc, geo: () => quad(p0, p1, top + 0.3, top + HR - 0.6, 0.25) });
    });
    add({ trade: 'canopy', grp: 'canopy', name: 'Entrance canopy', line: 'ca', start: 9, fit: 10, geo: () => box(10, 0.5, 4.2, 39, 5.9, 2.1) });
    add({ trade: 'temp', grp: 'craneOut', name: 'Tower crane (removal)', line: 'tc', fit: 4, temp: true, geo: () => merge([box(1.6, 60, 1.6, 44, 30, 10), box(48, 1.2, 1.2, 36, 58, 10)]) });
    // The street hoarding is drawn only if its removal falls late; the P-001 line "ho" is its replacement, not removal.
    add({ trade: 'temp', grp: 'hoardingOut', name: 'Street hoarding (removal)', line: null, fit: null, temp: true, geo: () => box(80, 2.6, 0.2, 30, 1.3, 11) });
    add({ trade: 'finishes', grp: 'plaza', name: 'Entrance plaza and landscaping', line: null, fit: null, geo: () => box(70, 0.25, 10, 33, 0.12, 5.2) });
    add({ trade: 'finishes', grp: 'signage', name: 'Building signage', line: null, fit: null, geo: () => box(14, 2.2, 0.3, 52, top - 2, 0.5) });
    // Hidden work: in the list, never drawn as done or late.
    [1, 2, 3].forEach((f) => add({ trade: 'hidden', grp: 'fitout', name: `Interior fit-out, floor ${f + 1}`, line: 'fo', hidden: true, geo: null }));
    add({ trade: 'hidden', grp: 'mep', name: 'Services risers (mechanical, electrical, plumbing)', line: null, hidden: true, geo: null });
    add({ trade: 'hidden', grp: 'waterproof', name: 'Roof waterproofing', line: 'rw', hidden: true, geo: null });
    E.forEach((e) => {
      e.planned = PLAN[e.grp];
    });
    return E;
  }
  function merge(gs) {
    const THREE = window.THREE;
    const pos = [];
    gs.forEach((g) => {
      const ng = g.index ? g.toNonIndexed() : g;
      pos.push(...ng.attributes.position.array);
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.computeVertexNormals();
    return out;
  }

  window.PoPModel = { GEO, CAM, PLAN, TRADES, BASE_PERIOD, FIT_LAST, elements };
})();
