// Demo seed data. EVERYTHING HERE IS FICTIONAL except the site photos.
// Project P-001 uses the 11 blurred public frames of a real building filmed by a fixed public camera
// (IITU dataset, Keresh, Mendeley Data, CC BY 4.0). Its progress claims, percentages, amounts and
// reviewer decisions are made up for the demo. The two reader labels per line were recorded in the
// prototype's evaluation by two AI labellers; the demo readers replay them and are labelled
// "Demo, not a model result". Projects P-002 and P-003, their contractors and staff are invented.

const DEMO_TODAY = '2026-06-01'; // a Monday: the May 2026 period has just closed

const USERS = [
  { id: 'eng-ana', role: 'engineer', name: 'Ana Reyes (demo)', title: 'Engineer, person in charge' },
  { id: 'eng-carlo', role: 'engineer', name: 'Carlo Bautista (demo)', title: 'Engineer, person in charge' },
  { id: 'rev-benita', role: 'reviewer', name: 'Benita Cruz (demo)', title: 'Municipal Engineer, office head' },
  { id: 'mayor', role: 'mayor', name: 'Mayor Lina Torres (demo)', title: 'Municipal Mayor' },
  { id: 'aud-coa', role: 'auditor', name: 'Rafael Santos (demo)', title: 'COA resident auditor', agency: 'COA' },
  { id: 'aud-ias', role: 'auditor', name: 'Mila Ocampo (demo)', title: 'Internal Audit Service', agency: 'IAS' },
  { id: 'aud-dilg', role: 'auditor', name: 'Jun Bautista (demo)', title: 'DILG field officer', agency: 'DILG' },
  { id: 'fund-grace', role: 'funder', name: 'Grace Lim (demo)', title: 'Owner and lender representative, read only' }
];

// ---------- P-001: the building on the public camera ----------
const P001_LINES = [
  { key: 'gc', label: 'Glazing, curved front facade', publicLabel: 'Glass on the curved front of the building', weight: 18.4,
    q: { partial: 'Glazing is installed on part of the curved front facade, with open bays remaining.', done: 'Glazing is installed across the visible curved front facade, with no open bays.', none: 'No glazing is installed on the curved front facade.' } },
  { key: 'gr', label: 'Glazing, right-hand wing', publicLabel: 'Glass on the right-hand wing', weight: 12.1,
    q: { partial: 'The right-hand wing is partly glazed, with open bays remaining.', done: 'The right-hand wing facade is fully glazed.', none: 'No glazing is installed on the right-hand wing.' } },
  { key: 'rs', label: 'Rooftop level steel frame', publicLabel: 'Steel frame on the rooftop level', weight: 6.0,
    q: { partial: 'Part of a steel frame is erected on the rooftop level.', done: 'A steel frame is erected on the rooftop level.', none: 'No steel frame is visible on the rooftop level.' } },
  { key: 're', label: 'Rooftop level enclosure (walls and cladding)', publicLabel: 'Walls and cladding on the rooftop level', weight: 9.6,
    q: { partial: 'The rooftop level is partly enclosed, with some open sides remaining.', done: 'The rooftop level is fully enclosed, with no open sides visible.', none: 'The rooftop level has no walls or cladding yet.' } },
  { key: 'rm', label: 'Rooftop masonry partitions', publicLabel: 'Block walls on the rooftop level', weight: 2.4,
    q: { partial: 'Some masonry block walls are visible on the rooftop level.', done: 'Masonry block walls are visible on the rooftop level.', none: 'No masonry block walls are visible on the rooftop level.' } },
  { key: 'tc', label: 'Tower crane removal', publicLabel: 'Tower crane removal', weight: 0.8, status: { done: 'done', none: 'not done' },
    q: { done: 'No tower crane stands in front of the building.', none: 'A tower crane still stands in front of the building.' } },
  { key: 'mc', label: 'Mobile crane hire', publicLabel: 'Mobile crane on site', weight: 0.6, status: { done: 'on site', none: 'not on site' },
    q: { done: 'A mobile crane is working at the front of the building.', none: 'No mobile crane is at the front of the building.' } },
  { key: 'ca', label: 'Main entrance canopy', publicLabel: 'Entrance canopy', weight: 3.2,
    q: { partial: 'Entrance canopy work is visible at street level, but the canopy is not finished.', done: 'A finished entrance canopy is visible at street level.', none: 'No entrance canopy work is visible at street level.' } },
  { key: 'wp', label: 'Temporary weather protection on the roof', publicLabel: 'Temporary roof covers', weight: 0.4, status: { done: 'in place', none: 'not in place' },
    q: { done: 'Temporary weather protection (tarps) covers the rooftop.', none: 'No temporary weather protection covers the rooftop.' } },
  { key: 'ho', label: 'Street hoarding replacement', publicLabel: 'New site fence along the street', weight: 1.1,
    q: { partial: 'Part of the street hoarding is green with white circular logos.', done: 'The street hoarding is green with white circular logos.', none: 'None of the street hoarding is green.' } },
  { key: 'rw', label: 'Roof waterproofing', publicLabel: 'Roof waterproofing', weight: 2.8, hidden: true },
  { key: 'fo', label: 'Interior fit-out, floors 2 to 4', publicLabel: 'Interior work, floors 2 to 4', weight: 21.0, hidden: true }
];

// Month key in the prototype -> reporting period, photo file and what was recorded from the source clip.
const MONTHS = [
  { k: '01', period: '2025-06', file: 'p01.jpg', stamp: '06-25-2025 Wed 14:26:18', res: '1920x1080', emb: null, framing: 'the original framing was about 1.36 times wider; this frame was aligned to the May 2026 view through July 2025' },
  { k: '02', period: '2025-07', file: 'p02.jpg', stamp: '07-27-2025 Sun 18:02:37', res: '1920x1080', emb: null, framing: 'the original framing was about 1.36 times wider; aligned to the May 2026 view' },
  { k: '03', period: '2025-08', file: 'p03.jpg', stamp: '08-31-2025 Sun 11:59:24', res: '1920x1080', emb: null, framing: 'the original framing was about 1.36 times wider; aligned to the May 2026 view' },
  { k: '04', period: '2025-09', file: 'p04.jpg', stamp: '09-06-2025 Sat 18:07:07', res: '1920x1080', emb: null, framing: 'the original framing was about 1.36 times wider; aligned to the May 2026 view' },
  { k: '05', period: '2025-10', file: 'p05.jpg', stamp: '10-20-2025 Mon 12:14:04', res: '1920x1080', emb: null },
  { k: '06', period: '2025-11', file: 'p06.jpg', stamp: '11-19-2025 Wed 10:55:21', res: '1920x1080', emb: null },
  { k: '07', period: '2026-01', file: 'p07.jpg', stamp: '01-17-2026 Sat 16:23:23', res: '704x576', emb: null, framing: 'winter snow and a low-resolution source; aligned through February 2026' },
  { k: '08', period: '2026-02', file: 'p08.jpg', stamp: '02-20-2026 Fri 12:00:58', res: '1920x1080', emb: '2026-05-28T07:48' },
  { k: '09', period: '2026-03', file: 'p09.jpg', stamp: '03-07-2026 Sat 11:58:49', res: '1920x1080', emb: '2026-05-28T07:48' },
  { k: '10', period: '2026-04', file: 'p10.jpg', stamp: '04-25-2026 Sat 16:29:12', res: '1920x1080', emb: '2026-05-28T07:48' },
  // May 2026: the office uploads this frame itself (it is the e2e test's upload), so it is not seeded as a photo.
  { k: '11', period: '2026-05', file: 'p11.jpg', stamp: '05-21-2026 Thu 11:12:21', res: '1920x1080', emb: '2026-05-28T07:48', notSeeded: true }
];

// Progress claim lines per month (fictional), with the two recorded reader labels (A, B):
// S supported, C contradicted, N can't tell. From the prototype's data.js CLAIMS.
const CLAIMS = {
  '01': [
    { id: 'Q004', l: 'gc', s: 'Curtain-wall glazing, curved front facade: 35%', q: 'Glazing is installed on part of the curved front facade, with open bays remaining.', A: 'N', B: 'S', nA: 'Lower floors show mullions only; cannot confirm any glass installed.', nB: 'Lower facade has glazing while several upper bays remain open.' },
    { id: 'Q005', l: 'rs', s: 'Rooftop level steel frame: 100%', q: 'A steel frame is erected on the rooftop level.', A: 'S', B: 'S' },
    { id: 'Q006', l: 're', s: 'Rooftop level enclosure (walls and cladding): 10%', q: 'The rooftop level is partly enclosed, with some open sides remaining.', A: 'C', B: 'S', nA: 'Rooftop steel frame entirely open; no walls or cladding present.', nB: 'Rooftop enclosure has rear panels and open front bays.' },
    { id: 'Q007', l: 'tc', s: 'Tower crane demobilisation: not done', q: 'A tower crane still stands in front of the building.', A: 'S', B: 'S' }
  ],
  '02': [
    { id: 'Q008', l: 'gc', s: 'Curtain-wall glazing, curved front facade: 60%', q: 'Glazing is installed on part of the curved front facade, with open bays remaining.', A: 'S', B: 'S' },
    { id: 'Q009', l: 'gr', s: 'Curtain-wall glazing, right-hand wing: 70%', q: 'The right-hand wing is partly glazed, with open bays remaining.', A: 'S', B: 'S' },
    { id: 'Q010', l: 'tc', s: 'Tower crane demobilisation: not done', q: 'A tower crane still stands in front of the building.', A: 'S', B: 'S' }
  ],
  '03': [
    { id: 'Q014', l: 'gc', s: 'Curtain-wall glazing, curved front facade: 85%', q: 'Glazing is installed on part of the curved front facade, with open bays remaining.', A: 'S', B: 'S' },
    { id: 'Q015', l: 'gr', s: 'Curtain-wall glazing, right-hand wing: 100%', q: 'The right-hand wing facade is fully glazed.', A: 'S', B: 'C', nA: 'Right-wing facade covered in glass above ground-level hoarding.', nB: 'Upper right-wing openings remain visibly unglazed.' },
    { id: 'Q016', l: 'rm', s: 'Rooftop masonry partitions: 40%', q: 'Some masonry block walls are visible on the rooftop level.', A: 'S', B: 'S' },
    { id: 'Q017', l: 'tc', s: 'Tower crane demobilisation: done', q: 'No tower crane stands in front of the building.', A: 'C', B: 'C' }
  ],
  '04': [
    { id: 'Q018', l: 'gc', s: 'Curtain-wall glazing, curved front facade: 100%', q: 'Glazing is installed across the visible curved front facade, with no open bays.', A: 'C', B: 'C' },
    { id: 'Q019', l: 'gr', s: 'Curtain-wall glazing, right-hand wing: 100%', q: 'The right-hand wing facade is fully glazed.', A: 'S', B: 'C', nA: 'Right-wing facade fully covered in glass panels.', nB: 'Right wing retains open upper bays.' },
    { id: 'Q020', l: 're', s: 'Rooftop level enclosure (walls and cladding): 30%', q: 'The rooftop level is partly enclosed, with some open sides remaining.', A: 'S', B: 'S' },
    { id: 'Q021', l: 'tc', s: 'Tower crane demobilisation: done', q: 'No tower crane stands in front of the building.', A: 'C', B: 'C' }
  ],
  '05': [
    { id: 'Q028', l: 'gc', s: 'Curtain-wall glazing, curved front facade: 100%', q: 'Glazing is installed across the visible curved front facade, with no open bays.', A: 'C', B: 'N', nA: 'Open bay with missing glass visible on lower curved front.', nB: 'Dark upper bays cannot confidently establish uninterrupted glazing.' },
    { id: 'Q029', l: 're', s: 'Rooftop level enclosure (walls and cladding): 60%', q: 'The rooftop level is partly enclosed, with some open sides remaining.', A: 'S', B: 'S' },
    { id: 'Q030', l: 'tc', s: 'Tower crane demobilisation: done', q: 'No tower crane stands in front of the building.', A: 'S', B: 'S' }
  ],
  '06': [
    { id: 'Q035', l: 'gr', s: 'Curtain-wall glazing, right-hand wing: 100%', q: 'The right-hand wing facade is fully glazed.', A: 'S', B: 'N', nA: 'Right-wing facade fully covered in glass above hoarding.', nB: 'Reflections and dark upper bays prevent confirmation of complete glazing.' },
    { id: 'Q036', l: 're', s: 'Rooftop level enclosure (walls and cladding): 80%', q: 'The rooftop level is partly enclosed, with some open sides remaining.', A: 'S', B: 'S' },
    { id: 'Q037', l: 'ca', s: 'Main entrance canopy: 20%', q: 'Entrance canopy work is visible at street level, but the canopy is not finished.', A: 'N', B: 'N' }
  ],
  '07': [
    { id: 'Q041', l: 'wp', s: 'Temporary weather protection on the roof: in place', q: 'Temporary weather protection (tarps) covers the rooftop.', A: 'C', B: 'S', nA: 'Only a small green tarp at one corner; rooftop mostly uncovered.', nB: 'Green protective sheeting is visible along the rooftop edge.' },
    { id: 'Q042', l: 're', s: 'Rooftop level enclosure (walls and cladding): 90%', q: 'The rooftop level is partly enclosed, with some open sides remaining.', A: 'S', B: 'S' },
    { id: 'Q043', l: 'ca', s: 'Main entrance canopy: 30%', q: 'Entrance canopy work is visible at street level, but the canopy is not finished.', A: 'N', B: 'N' }
  ],
  '08': [
    { id: 'Q051', l: 're', s: 'Rooftop level enclosure (walls and cladding): 100%', q: 'The rooftop level is fully enclosed, with no open sides visible.', A: 'C', B: 'C' },
    { id: 'Q052', l: 'rs', s: 'Rooftop level steel frame: 100%', q: 'A steel frame is erected on the rooftop level.', A: 'S', B: 'S' },
    { id: 'Q053', l: 'ca', s: 'Main entrance canopy: 40%', q: 'Entrance canopy work is visible at street level, but the canopy is not finished.', A: 'C', B: 'N', nA: 'Entrance area clearly visible; door frames only, no canopy structure.', nB: 'Hoarding obscures the entrance and possible canopy components.' }
  ],
  '09': [
    { id: 'Q054', l: 'mc', s: 'Mobile crane hire: on site', q: 'A mobile crane is working at the front of the building.', A: 'S', B: 'S' },
    { id: 'Q055', l: 'ca', s: 'Main entrance canopy: 70%', q: 'Entrance canopy work is visible at street level, but the canopy is not finished.', A: 'S', B: 'S' },
    { id: 'Q056', l: 're', s: 'Rooftop level enclosure (walls and cladding): 100%', q: 'The rooftop level is fully enclosed, with no open sides visible.', A: 'C', B: 'C' }
  ],
  '10': [
    { id: 'Q064', l: 'ca', s: 'Main entrance canopy: 100%', q: 'A finished entrance canopy is visible at street level.', A: 'C', B: 'N', nA: 'Canopy fascia still segmented framework; plywood boards beneath.', nB: 'Canopy roof is visible, but completion details are obscured by shadow and hoarding.' },
    { id: 'Q065', l: 're', s: 'Rooftop level enclosure (walls and cladding): 100%', q: 'The rooftop level is fully enclosed, with no open sides visible.', A: 'C', B: 'C' },
    { id: 'Q066', l: 'ho', s: 'Street hoarding replacement: 50%', q: 'Part of the street hoarding is green with white circular logos.', A: 'C', B: 'C' },
    { id: 'Q067', l: 'rw', s: 'Roof waterproofing: 100%', q: 'Roof waterproofing is at the reported stage (100%).', A: 'N', B: 'N' }
  ],
  '11': [
    { id: 'Q071', l: 'ho', s: 'Street hoarding replacement: 100%', q: 'The street hoarding is green with white circular logos.', A: 'S', B: 'S' },
    { id: 'Q072', l: 'rm', s: 'Rooftop masonry partitions: 100%', q: 'Masonry block walls are visible on the rooftop level.', A: 'S', B: 'S' },
    { id: 'Q073', l: 'fo', s: 'Interior fit-out, floors 2 to 4: 90%', q: 'Interior fit-out of floors 2 to 4 is at the reported stage (90%).', A: 'N', B: 'N' }
  ]
};

// The reviewer's seeded decisions (fictional) where she did not simply agree with both readers.
const P001_DECISIONS = {
  Q004: ['supported', 'Glass is visible on the lower left of the curved front; upper bays open, which fits 35%.'],
  Q006: ['contradicted', 'Rooftop frame is open on the sides this camera sees.'],
  Q015: ['contradicted', 'Upper right-wing bays are still open in this frame.'],
  Q019: ['supported', 'Right wing looks fully glazed in the September frame.'],
  Q028: ['not_assessable', 'Dark upper bays; cannot tell from this frame. Check on the next visit.'],
  Q035: ['supported', 'Glass visible across the wing; reflections only.'],
  Q037: ['supported', 'Canopy steel seen at street level on the 21 Nov site visit; the frame does not show it clearly.'],
  Q041: ['not_assessable', 'Low-resolution winter frame; tarp coverage unclear.'],
  Q053: ['not_assessable', 'Street level is blurred in this copy, so the entrance canopy cannot be seen. Check on the next site visit.'],
  Q064: ['not_assessable', 'Street level is blurred in this copy, so the entrance canopy cannot be seen. Check on the next site visit.']
};

const P001_PERCENT = { '2025-06': 40, '2025-07': 45, '2025-08': 50, '2025-09': 53, '2025-10': 56, '2025-11': 58, '2025-12': 59, '2026-01': 60, '2026-02': 62, '2026-03': 64, '2026-04': 68 };

const PROJECTS = [
  {
    id: 'P-001',
    name: 'Multi-purpose building (demo)',
    location: 'Demo site. Photos: public site camera, IITU dataset (CC BY 4.0)',
    contractor: 'Alpha Builders (fictional)',
    contractId: 'DEMO-2025-001',
    contractAmount: 98500000,
    inChargeId: 'eng-ana',
    startDate: '2024-09-01',
    firstPeriod: '2025-06',
    milestones: [
      { pct: 20, due: '2025-01-31' },
      { pct: 40, due: '2025-05-31' },
      { pct: 70, due: '2026-03-31' },
      { pct: 100, due: '2026-12-31' }
    ],
    site: null,
    lines: P001_LINES,
    fictional: true,
    demoToken: 'demo-P-001-alpha-link'
  },
  {
    id: 'P-002',
    name: 'Farm-to-market road concreting, 1.2 km (demo)',
    location: 'Barangay Uno (fictional), Demo Town (fictional)',
    contractor: 'Uno Road Builders (fictional)',
    contractId: 'DEMO-2026-002',
    contractAmount: 14800000,
    inChargeId: 'eng-carlo',
    startDate: '2026-01-05',
    firstPeriod: '2026-01',
    milestones: [
      { pct: 20, due: '2026-02-15' },
      { pct: 40, due: '2026-03-31' },
      { pct: 70, due: '2026-05-15' },
      { pct: 100, due: '2026-07-31' }
    ],
    site: { lat: 13.03, lon: 126.53, radiusM: 800 }, // synthetic coordinates (open sea), not a real site
    lines: [
      { key: 'sb', label: 'Subgrade preparation', weight: 10 },
      { key: 'abc', label: 'Aggregate base course', weight: 18 },
      { key: 'pccp', label: 'Concrete pavement (PCCP)', weight: 52 },
      { key: 'lc', label: 'Lined canal', weight: 10 },
      { key: 'sp', label: 'Slope protection (grouted riprap)', weight: 8 },
      { key: 'sg', label: 'Project signboard', weight: 1, status: { done: 'installed', none: 'not installed' } },
      { key: 'ct', label: 'Concrete strength tests', weight: 1, hidden: true }
    ],
    percent: { '2026-01': 8, '2026-02': 18, '2026-03': 30, '2026-04': 35 },
    fictional: true,
    demoToken: 'demo-P-002-uno-link'
  },
  {
    id: 'P-003',
    name: 'Barangay hall annex, two storeys (demo)',
    location: 'Barangay Dos (fictional), Demo Town (fictional)',
    contractor: 'Dos Construction (fictional)',
    contractId: 'DEMO-2026-003',
    contractAmount: 6200000,
    inChargeId: 'eng-ana',
    startDate: '2026-02-02',
    firstPeriod: '2026-02',
    milestones: [
      { pct: 20, due: '2026-03-15' },
      { pct: 40, due: '2026-05-15' },
      { pct: 70, due: '2026-07-31' },
      { pct: 100, due: '2026-09-30' }
    ],
    site: { lat: 13.01, lon: 126.51, radiusM: 300 }, // synthetic coordinates (open sea), not a real site
    lines: [
      { key: 'fd', label: 'Footings and foundation', weight: 12, hidden: true },
      { key: 'cb', label: 'Columns and beams', weight: 22 },
      { key: 'sl', label: 'Second-floor slab', weight: 18 },
      { key: 'chb', label: 'Hollow-block walls', weight: 16 },
      { key: 'rf', label: 'Roofing', weight: 14 },
      { key: 'el', label: 'Electrical rough-in', weight: 9, hidden: true },
      { key: 'pl', label: 'Plumbing rough-in', weight: 9, hidden: true }
    ],
    percent: { '2026-02': 10, '2026-03': 22, '2026-04': 33 },
    fictional: true,
    demoToken: 'demo-P-003-dos-link'
  }
];

// P-003's May 2026 progress claim, sent through the contractor link (fictional). Its photo is a
// mirrored copy of P-001's February 2026 frame, made at seed time, to show the reuse and flip check.
const P003_MAY_CLAIM = { fd: 100, cb: 80, sl: 60, chb: 30, rf: 0, el: 20, pl: 15 };
// Demo reader labels for that claim. Invented for the demo (no model was run on this photo); the demo
// readers replay them and every screen labels them "Demo, not a model result".
const P003_RECORDED = {
  cb: { A: 'S', B: 'C', noteA: 'Columns and beams visible on both floors at the front.', noteB: 'Only ground-floor columns are clearly visible; upper frame unclear.' },
  sl: { A: 'S', B: 'S' },
  chb: { A: 'S', B: 'N', noteA: 'Block walls visible on part of the ground floor.', noteB: 'Hoarding hides most of the ground floor.' },
  rf: { A: 'S', B: 'S' }
};

// Reports submitted late in the seed (kind|periodKey -> days after the due date).
const LATE = {
  'P-001': { 'SUBAYBAYAN|2025-07': 3, 'COA|2026-01': 4, 'MPDO|2025-Q3': 2 },
  'P-002': { 'COA|2026-04': 4 },
  'P-003': {}
};
// Reports deliberately not submitted in the seed.
const MISSING = { 'P-002': ['SUBAYBAYAN|2026-05'] };

const RECIPIENT = {
  SUBAYBAYAN: ['DILG municipal field office', 'Encoded in SubayBAYAN; printout stamped received'],
  COA: ['COA resident auditor', 'Hand-carried; receiving copy stamped'],
  IAS: ['Internal Audit Service', 'Hand-carried; receiving copy stamped'],
  MPDO: ['Municipal Planning and Development Office', 'Hand-carried'],
  YEAR_END: ['Office of the Mayor and MPDO', 'Hand-carried']
};

const MONITORING = [
  { projectId: 'P-001', by: 'eng-ana', date: '2025-12-18', kind: 'Site visit', hours: 3, note: 'No camera footage in December. Walked the site; rooftop framing still open on the street side.' },
  { projectId: 'P-001', by: 'eng-ana', date: '2025-11-21', kind: 'Site visit', hours: 2, note: 'Checked the entrance canopy steel from the street.' },
  { projectId: 'P-002', by: 'eng-carlo', date: '2026-03-28', kind: 'Site visit', hours: 9, note: 'Four-hour walk from the end of the road each way. Pavement poured on about a third of the length.' },
  { projectId: 'P-002', by: 'eng-carlo', date: '2026-04-29', kind: 'Remote check', hours: 0.5, note: "Phone call with the contractor's foreman; no photos sent." },
  { projectId: 'P-003', by: 'eng-ana', date: '2026-04-15', kind: 'Site visit', hours: 2, note: 'Columns up to the second floor; slab formwork started.' }
];

module.exports = { DEMO_TODAY, USERS, PROJECTS, MONTHS, CLAIMS, P001_DECISIONS, P001_PERCENT, P003_MAY_CLAIM, P003_RECORDED, LATE, MISSING, RECIPIENT, MONITORING };
