// Loads the fictional demo data (see demo-data.js). Run automatically at start when SEED=demo and
// the store is empty, or with `npm run seed`. Seeding never calls a live model: the seeded checks
// replay saved Gemini answers where they exist (src/seed/saved-runs.json) and otherwise use the demo
// readers, so nothing is billed and results are repeatable.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const D = require('./demo-data');
const { hashToken } = require('../auth');
const { addPhoto, setClaims, decideLine, contractorSubmit } = require('../services/actions');
const { runCheck, getOrCreatePeriod, periodId } = require('../services/check');
const { createMockReaders } = require('../ai/mock');
const { obligationsFor, addDays, monthEnd, KINDS } = require('../domain/deadlines');
const { pctFromStatement } = require('../domain/lines');

const PHOTO_DIR = path.join(__dirname, '..', '..', 'seed-photos');
const MAP = { S: 'supported', C: 'contradicted', N: 'not_assessable' };

function stampDate(stamp) {
  const m = stamp.match(/^(\d{2})-(\d{2})-(\d{4})/);
  return `${m[3]}-${m[1]}-${m[2]}`;
}

async function seedDemo({ store, photoStore, readers: seedReaders }) {
  await store.clear();
  await photoStore.clear();
  const today = D.DEMO_TODAY;
  const users = Object.fromEntries(D.USERS.map((u) => [u.id, u]));
  for (const u of D.USERS) await store.set('users', u.id, { ...u, demo: true });

  for (const p of D.PROJECTS) {
    const { demoToken, percent, ...rest } = p;
    const doc = { ...rest, contractorTokenHash: hashToken(demoToken), contractorLinkCreatedAt: '2026-01-05T00:00:00.000Z' };
    if (p.id === 'P-001') {
      doc.recordedLabels = {};
      for (const m of D.MONTHS)
        for (const c of D.CLAIMS[m.k] || []) doc.recordedLabels[`${m.period}|${c.l}`] = { pct: pctFromStatement(c.s), A: c.A, B: c.B, noteA: c.nA || '', noteB: c.nB || '' };
    }
    if (p.id === 'P-003') {
      doc.recordedLabels = {};
      for (const [k, r] of Object.entries(D.P003_RECORDED)) doc.recordedLabels[`2026-05|${k}`] = { pct: D.P003_MAY_CLAIM[k], noteA: '', noteB: '', ...r };
    }
    await store.set('projects', p.id, doc);
  }
  const project = async (id) => store.get('projects', id);
  const readers = seedReaders || createMockReaders();
  const ana = users['eng-ana'];
  const benita = users['rev-benita'];

  // ---------- P-001 ----------
  let p1 = await project('P-001');
  for (const m of D.MONTHS) {
    const claims = (D.CLAIMS[m.k] || []).map((c) => ({ lineKey: c.l, claimedPct: pctFromStatement(c.s), statement: c.s, question: c.q, claimId: c.id }));
    const officeTyped = m.period === '2026-04';
    if (!m.notSeeded) {
      const day = stampDate(m.stamp);
      await addPhoto({
        store,
        photoStore,
        project: p1,
        period: m.period,
        buffer: fs.readFileSync(path.join(PHOTO_DIR, m.file)),
        fileName: m.file,
        contentType: 'image/jpeg',
        user: ana,
        source: 'office',
        stampText: m.stamp,
        createdAt: `${day}T10:00:00.000Z`,
        recorded: {
          exif: { taken: m.emb, gps: null, make: null, model: null },
          metadataSource: 'recorded from the source video clip; the blurred public frame carries no metadata of its own',
          sourceResolution: m.res,
          framingNote: m.framing || ''
        }
      });
    }
    if (officeTyped) {
      await setClaims({ store, project: p1, period: m.period, claims, user: ana, source: 'office', today: '2026-04-28' });
    } else {
      await contractorSubmit({ store, photoStore, project: p1, period: m.period, claims, files: [], note: '', receivedAt: `${addDays(monthEnd(m.period), -3)}T08:00:00.000Z` });
    }
    if (m.notSeeded) continue; // May 2026 waits for the office's photo upload and check
    await runCheck({ store, photoStore, readers, project: p1, period: m.period, user: ana });
    const per = await store.get('periods', periodId('P-001', m.period));
    const at = `${addDays(monthEnd(m.period), 5)}T09:00:00.000Z`;
    for (const l of per.check.lines) {
      const rec = (D.CLAIMS[m.k] || []).find((c) => c.l === l.lineKey);
      let decision;
      let reason;
      if (D.P001_DECISIONS[rec.id]) [decision, reason] = D.P001_DECISIONS[rec.id];
      else if (l.hidden) [decision, reason] = ['not_assessable', 'Hidden work; cannot be seen from the camera.'];
      else [decision, reason] = [MAP[rec.A], rec.A === 'N' ? 'Not clear enough in this frame to say.' : 'Agree with both readers; visible in the frame.'];
      await decideLine({ store, project: p1, period: m.period, lineKey: l.lineKey, decision, reason, user: benita, at });
    }
  }
  for (const [period, value] of Object.entries(D.P001_PERCENT)) {
    const per = await getOrCreatePeriod(store, p1, period);
    const entry = { value, enteredBy: ana.id, enteredByName: ana.name, enteredAt: `${addDays(monthEnd(period), 2)}T08:00:00.000Z` };
    await store.update('periods', per.id, { percentComplete: entry, percentHistory: [entry] });
  }

  // ---------- P-002 and P-003: percent entries ----------
  for (const pid of ['P-002', 'P-003']) {
    const pr = await project(pid);
    const src = D.PROJECTS.find((x) => x.id === pid);
    const eng = users[pr.inChargeId];
    for (const [period, value] of Object.entries(src.percent)) {
      const per = await getOrCreatePeriod(store, pr, period);
      const entry = { value, enteredBy: eng.id, enteredByName: eng.name, enteredAt: `${addDays(monthEnd(period), 2)}T08:00:00.000Z` };
      await store.update('periods', per.id, { percentComplete: entry, percentHistory: [entry] });
    }
  }

  // ---------- P-003 May 2026: contractor's progress claim with a mirrored copy of a P-001 frame ----------
  const p3 = await project('P-003');
  const mirrored = await sharp(fs.readFileSync(path.join(PHOTO_DIR, 'p08.jpg'))).flop().jpeg({ quality: 88 }).toBuffer();
  await contractorSubmit({
    store,
    photoStore,
    project: p3,
    period: '2026-05',
    claims: Object.entries(D.P003_MAY_CLAIM).map(([lineKey, claimedPct]) => ({ lineKey, claimedPct })),
    files: [{ buffer: mirrored, originalname: 'annex_may.jpg', mimetype: 'image/jpeg', createdAt: '2026-05-28T03:00:00.000Z' }],
    note: 'May progress claim. Photo of the front.',
    receivedAt: '2026-05-28T03:00:00.000Z'
  });
  await runCheck({ store, photoStore, readers, project: p3, period: '2026-05', user: ana });

  // ---------- transmittal log ----------
  for (const pr of D.PROJECTS) {
    const eng = users[pr.inChargeId];
    for (const o of obligationsFor(pr, today, 0)) {
      if (o.due >= today) continue;
      const k = `${o.kind}|${o.periodKey}`;
      if ((D.MISSING[pr.id] || []).includes(k)) continue;
      const lateBy = (D.LATE[pr.id] || {})[k];
      const submittedOn = lateBy ? addDays(o.due, lateBy) : addDays(o.due, -1);
      const [to, via] = D.RECIPIENT[o.kind];
      const id = `tr_seed_${pr.id}_${o.kind}_${o.periodKey}`;
      await store.set('transmittals', id, {
        id,
        projectId: pr.id,
        reportKind: o.kind,
        reportName: KINDS[o.kind].name,
        periodKey: o.periodKey,
        due: o.due,
        submittedOn,
        to,
        via,
        refNo: `DEMO-${o.kind.slice(0, 3)}-${o.periodKey}`,
        photoId: null,
        late: !!lateBy,
        daysLate: lateBy || 0,
        countsAsOnTime: !lateBy,
        loggedBy: { uid: eng.id, name: eng.name, role: eng.role },
        loggedAt: `${submittedOn}T09:00:00.000Z`
      });
    }
  }

  // ---------- monitoring credit ----------
  for (const m of D.MONITORING) {
    const u = users[m.by];
    const id = `mon_seed_${m.projectId}_${m.date}`;
    await store.set('monitoring', id, { id, projectId: m.projectId, date: m.date, kind: m.kind, hours: m.hours, note: m.note, by: { uid: u.id, name: u.name, role: u.role }, onBehalfOfContractor: false, auto: null, loggedAt: `${m.date}T12:00:00.000Z` });
  }
  await store.set('meta', 'seed', { id: 'seed', kind: 'demo', at: new Date().toISOString(), today });
  return { today, tokens: Object.fromEntries(D.PROJECTS.map((p) => [p.id, p.demoToken])) };
}

module.exports = { seedDemo };

if (require.main === module) {
  // `npm run seed`: start-up seeding with SEED=reset, without serving.
  require('../server')
    .build({ ...process.env, SEED: 'reset' })
    .then(async ({ store }) => {
      console.log(`Seeded demo data into ${store.kind}.`);
      await store.close();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
