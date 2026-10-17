// The HTTP service: JSON API with role guards on every route, plus the thin front end.
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { PRODUCT_NAME, BRAND, BRAND_DISPLAY } = require('./brand');
const { authMiddleware, allow, requireAppHeader, setSession, clearSession, hashToken, newToken } = require('./auth');
const A = require('./services/actions');
const { runCheck, periodId } = require('./services/check');
const { projectSnapshot, allSnapshots, usersMap, effectiveDecisions } = require('./services/snapshot');
const { buildDrafts, toText, toCsv, toHtml, csvCell } = require('./domain/reports');
const { publicNote } = require('./domain/publicnote');
const { weekRange, KINDS, PERIOD_REPORT_KINDS } = require('./domain/deadlines');
const { PHRASES, VERDICT_LABEL, neutralize } = require('./domain/wording');
const { monthLabel, periodKeyLabel } = require('./domain/escalation');
const { PROJECTS: DEMO_PROJECTS } = require('./seed/demo-data');
const { als, TEMPLATE, MAIN } = require('./workspace');
const { createWorkspaces } = require('./services/workspaces');
const { draftNote } = require('./services/notes');
const { createPhotoQuota } = require('./services/quota');
const { manilaDate } = require('./clock');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp({ config, store, rootStore, photoStore, readers, live, spend, clock, reseed }) {
  rootStore = rootStore || store.root || store;
  const app = express();
  app.disable('x-powered-by');
  // Cloud Run puts exactly one proxy (Google's front end) in front of the service: trust that hop only,
  // so a client cannot choose its own address through X-Forwarded-For.
  app.set('trust proxy', 1);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 8 } });
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  // Uploads are held in memory while they are checked, so only a few run at once across the service,
  // and each visitor copy holds a limited number of photos.
  const MAX_UPLOADS_AT_ONCE = 4;
  const MAX_PHOTOS_PER_COPY = 60;
  let uploadsRunning = 0;
  const uploadGate = (req, res, next) => {
    if (uploadsRunning >= MAX_UPLOADS_AT_ONCE) return res.status(503).json({ error: 'Busy with other uploads. Please try again in a few seconds.' });
    uploadsRunning++;
    let done = false;
    const release = () => {
      if (!done) {
        done = true;
        uploadsRunning--;
      }
    };
    res.on('finish', release);
    res.on('close', release);
    next();
  };
  const quota = createPhotoQuota({ store, enabled: config.workspaces, max: MAX_PHOTOS_PER_COPY });
  const reservePhotoSlots = (n) => quota.reserve(n);
  const releasePhotoSlots = (n) => quota.release(n);
  const photoLimitMsg = `A visitor copy of the demo holds at most ${MAX_PHOTOS_PER_COPY} photos.`;
  const today = () => clock.today();
  const isSecure = (req) => req.secure || config.production;

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', requireAppHeader);

  // Workspace and judge access for this request. Without a workspace a visitor reads the seeded demo,
  // which is read-only for requests (src/store/index.js). A copy is created only by a valid sign-in or a
  // valid contractor submission (req.ensureWorkspace), after the request has been checked.
  const workspaces = createWorkspaces({ rootStore, config, dayFn: () => manilaDate(new Date()) });
  app.use((req, res, next) => {
    const judge = workspaces.readJudge(req);
    const ctx = { ws: MAIN, judge, request: true, expiresAt: null };
    if (config.workspaces) {
      const cur = workspaces.read(req);
      req.workspace = cur;
      ctx.ws = cur ? cur.id : TEMPLATE;
      ctx.expiresAt = cur ? cur.expiresAt : null;
      req.ensureWorkspace = async () => {
        if (ctx.ws !== TEMPLATE) return;
        const created = await workspaces.create();
        workspaces.write(res, created, isSecure(req));
        req.workspace = created;
        ctx.ws = created.id;
        ctx.expiresAt = created.expiresAt;
      };
    } else req.ensureWorkspace = async () => {};
    req.judge = judge;
    als.run(ctx, () => next());
  });
  app.use(authMiddleware({ config, store }));

  // ---------- helpers ----------
  async function loadProject(req, res) {
    const p = await store.get('projects', req.params.id);
    if (!p) {
      res.status(404).json({ error: 'No such project.' });
      return null;
    }
    return p;
  }
  // Engineers may change only the projects they are in charge of. The reviewer may act on any.
  function canWrite(user, project) {
    if (user.role === 'reviewer') return true;
    return user.role === 'engineer' && project.inChargeId === user.id;
  }
  function requireWrite(req, res, project) {
    if (!canWrite(req.user, project)) {
      res.status(403).json({ error: 'Only the person in charge of this project or the reviewer can change it.' });
      return false;
    }
    return true;
  }
  const photoMeta = (p) => ({
    id: p.id,
    period: p.period,
    fileName: p.fileName,
    width: p.width,
    height: p.height,
    stampText: p.stampText,
    exif: p.exif,
    metadataSource: p.metadataSource,
    sourceResolution: p.sourceResolution,
    framingNote: p.framingNote,
    source: p.source,
    uploadedBy: p.uploadedBy,
    createdAt: p.createdAt,
    url: `/api/photos/${p.id}`
  });
  function projectSummary(p, snap) {
    return {
      id: p.id,
      name: p.name,
      location: p.location,
      contractor: p.contractor,
      contractId: p.contractId,
      inChargeId: p.inChargeId,
      inChargeName: snap ? snap.inChargeName : null,
      fictional: !!p.fictional,
      latest: snap ? snap.latest : null,
      plannedToday: snap ? snap.plannedToday : null,
      slippage: snap ? snap.slippage : null,
      level: snap ? snap.level : 0
    };
  }
  const sendErr = (res, e) => res.status(e.status || 400).json({ error: e.message });

  // ---------- meta, health ----------
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/api/meta', (req, res) =>
    res.json({
      productName: PRODUCT_NAME,
      brand: BRAND,
      brandDisplay: BRAND_DISPLAY,
      today: today(),
      demoDate: clock.fixed,
      aiMode: readers.mode,
      store: store.kind,
      photos: photoStore.kind,
      demoLogin: config.demoLogin,
      // Live model calls need the judge access code; everyone else sees saved Gemini runs.
      access: { judge: !!req.judge, liveAi: config.ai !== 'mock', codeConfigured: !!config.judgeCode },
      model: config.ai === 'mock' ? 'demo-reader' : config.geminiModel,
      workspace: config.workspaces ? (req.workspace ? { id: req.workspace.id.slice(0, 7), expiresAt: req.workspace.expiresAt, own: true } : { own: false }) : null,
      phrases: PHRASES,
      verdictLabels: VERDICT_LABEL,
      reportKinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.name])),
      monitoringKinds: A.MONITORING_KINDS,
      // Only for the fictional demo: the seeded contractor links, so a visitor can try the contractor page.
      demoContractorLinks: ['demo', 'reset'].includes(config.seed) && config.demoLogin ? DEMO_PROJECTS.map((p) => ({ projectId: p.id, name: p.name, link: `/c/${p.demoToken}` })) : []
    })
  );

  // ---------- judge access code ----------
  // Tries per client address (20 an hour) and in total (300 an hour); old entries expire one by one.
  const attempts = new Map();
  let allTries = [];
  const HOUR = 3600000;
  app.post('/api/access', (req, res) => {
    const ip = req.ip || 'x';
    const now = Date.now();
    allTries = allTries.filter((t) => now - t < HOUR);
    for (const [k, v] of attempts) if (!v.some((t) => now - t < HOUR)) attempts.delete(k);
    const a = (attempts.get(ip) || []).filter((t) => now - t < HOUR);
    if (a.length >= 20 || allTries.length >= 300) return res.status(429).json({ error: 'Too many tries. Please wait an hour.' });
    a.push(now);
    allTries.push(now);
    attempts.set(ip, a);
    if (!workspaces.codeMatches((req.body || {}).code)) return res.status(403).json({ error: 'That code is not right.' });
    workspaces.writeJudge(res, isSecure(req));
    res.json({ ok: true, judge: true });
  });

  // ---------- auth ----------
  app.get('/api/auth/demo-users', wrap(async (req, res) => {
    if (!config.demoLogin) return res.status(404).json({ error: 'Demo sign-in is off.' });
    const users = await store.find('users', {});
    res.json(users.sort((a, b) => a.id.localeCompare(b.id)).map((u) => ({ id: u.id, name: u.name, role: u.role, title: u.title, agency: u.agency || null })));
  }));
  app.post('/api/auth/login', wrap(async (req, res) => {
    if (!config.demoLogin) return res.status(404).json({ error: 'Demo sign-in is off.' });
    const u = await store.get('users', String((req.body || {}).userId || ''));
    if (!u) return res.status(400).json({ error: 'Pick a user.' });
    try {
      await req.ensureWorkspace();
    } catch (e) {
      return res.status(e.status || 500).json({ error: e.message });
    }
    setSession(res, u, config, isSecure(req));
    res.json({ id: u.id, name: u.name, role: u.role, home: `/${u.role}` });
  }));
  app.post('/api/auth/logout', (req, res) => {
    clearSession(res);
    res.json({ ok: true });
  });
  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not signed in.' });
    const u = req.user;
    res.json({ id: u.id, name: u.name, role: u.role, title: u.title, agency: u.agency || null });
  });

  // ---------- projects (engineer, reviewer, auditor) ----------
  const STAFF_READ = ['engineer', 'reviewer', 'auditor'];
  app.get('/api/projects', allow(...STAFF_READ), wrap(async (req, res) => {
    const { snaps } = await allSnapshots(store, today(), config.escalation);
    res.json(snaps.map((s) => ({ ...projectSummary(s.project, s), mine: s.project.inChargeId === req.user.id, canWrite: canWrite(req.user, s.project) })));
  }));

  app.get('/api/projects/:id', allow(...STAFF_READ), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p) return;
    const users = await usersMap(store);
    const snap = await projectSnapshot(store, p.id, today(), config.escalation, users);
    const periods = snap.data.periods.sort((a, b) => b.period.localeCompare(a.period));
    res.json({
      ...projectSummary(p, snap),
      canWrite: canWrite(req.user, p),
      startDate: p.startDate,
      milestones: p.milestones,
      overdueMilestones: snap.overdueMilestones,
      lines: p.lines.map((l) => ({ key: l.key, label: l.label, hidden: !!l.hidden, status: l.status || null })),
      site: p.site,
      periods: periods.map((x) => ({
        period: x.period,
        label: monthLabel(x.period),
        status: x.status,
        claims: (x.claims || []).length,
        claimsSource: x.claimsSource || null,
        checked: !!x.check,
        percent: x.percentComplete ? x.percentComplete.value : null
      })),
      obligations: snap.obligations.map((o) => ({ ...o, label: `${o.name}, ${periodKeyLabel(o.periodKey)}` })),
      items: snap.items,
      monitoring: snap.data.monitoring.sort((a, b) => b.date.localeCompare(a.date)),
      transmittals: snap.data.transmittals.sort((a, b) => b.submittedOn.localeCompare(a.submittedOn)),
      contractorLink: { exists: !!p.contractorTokenHash, createdAt: p.contractorLinkCreatedAt || null }
    });
  }));

  app.get('/api/projects/:id/periods/:period', allow(...STAFF_READ), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p) return;
    const period = req.params.period;
    const per = (await store.get('periods', periodId(p.id, period))) || { period, claims: [], status: 'open' };
    const photos = (await store.find('photos', { projectId: p.id, period })).filter((x) => x.source !== 'transmittal').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const decisions = await store.find('decisions', { projectId: p.id });
    const eff = effectiveDecisions(decisions);
    const subs = (await store.find('submissions', { projectId: p.id, period })).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const check = per.check
      ? {
          ...per.check,
          lines: per.check.lines.map((l) => {
            const d = eff.get(`${period}|${l.lineKey}`);
            const cur = d && d.checkRunId === per.check.runId && !per.checkStale;
            const shape = (x) => ({ decision: x.decision, reason: x.reason, by: x.by, at: x.at, overrode: x.overrode });
            // A decision made on an earlier run is shown for reference only: the new run waits for a person.
            return { ...l, decision: cur ? shape(d) : null, earlierDecision: d && !cur ? shape(d) : null };
          })
        }
      : null;
    res.json({
      projectId: p.id,
      period,
      label: monthLabel(period),
      status: per.status,
      claims: per.claims || [],
      claimsSource: per.claimsSource || null,
      checkStale: !!per.checkStale,
      checkStaleReason: per.checkStaleReason || null,
      claimsUpdatedAt: per.claimsUpdatedAt || null,
      claimsUpdatedBy: per.claimsUpdatedBy || null,
      percentComplete: per.percentComplete || null,
      narrativeOverride: per.narrativeOverride || '',
      photos: photos.map(photoMeta),
      check,
      flagNotes: per.flagNotes || [],
      submissions: subs.map((s) => ({ id: s.id, receivedAt: s.receivedAt, claims: s.claims, photoIds: s.photoIds, note: s.note })),
      canWrite: canWrite(req.user, p),
      canDecide: canWrite(req.user, p)
    });
  }));

  // ---------- engineer work ----------
  app.post('/api/projects/:id/periods/:period/photos', allow('engineer', 'reviewer'), uploadGate, upload.array('photos', 8), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p || !requireWrite(req, res, p)) return;
    const stamps = [].concat((req.body && req.body.stampText) || []);
    const out = [];
    const n = (req.files || []).length;
    if (!(await reservePhotoSlots(n))) return res.status(403).json({ error: photoLimitMsg });
    try {
      for (const [i, f] of (req.files || []).entries()) {
        out.push(photoMeta(await A.addPhoto({ store, photoStore, project: p, period: req.params.period, buffer: f.buffer, fileName: f.originalname, contentType: f.mimetype, user: req.user, source: 'office', stampText: stamps[i] || stamps[0] || '' })));
      }
    } catch (e) {
      await releasePhotoSlots(n - out.length);
      return sendErr(res, e);
    }
    if (!out.length) return res.status(400).json({ error: 'Choose at least one photo.' });
    res.json({ photos: out });
  }));

  app.patch('/api/photos/:photoId', allow('engineer', 'reviewer'), wrap(async (req, res) => {
    const ph = await store.get('photos', req.params.photoId);
    if (!ph) return res.status(404).json({ error: 'No such photo.' });
    const p = await store.get('projects', ph.projectId);
    if (!requireWrite(req, res, p)) return;
    await A.setStamp({ store, photo: ph, stampText: (req.body || {}).stampText });
    res.json({ ok: true });
  }));

  app.put('/api/projects/:id/periods/:period/claims', allow('engineer', 'reviewer'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p || !requireWrite(req, res, p)) return;
    try {
      const claims = await A.setClaims({ store, project: p, period: req.params.period, claims: (req.body || {}).claims, user: req.user, source: 'office', today: today() });
      res.json({ claims });
    } catch (e) {
      sendErr(res, e);
    }
  }));

  app.post('/api/projects/:id/periods/:period/check', allow('engineer', 'reviewer'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p || !requireWrite(req, res, p)) return;
    const per = await store.get('periods', periodId(p.id, req.params.period));
    if (!per || !(per.claims || []).length) return res.status(400).json({ error: 'Add the claimed percent per line first (from the contractor or typed by the office).' });
    const t0 = Date.now();
    const check = await runCheck({ store, photoStore, readers, project: p, period: req.params.period, user: req.user });
    const ms = Date.now() - t0;
    // Time per claimed line, photo in to verdict: logged for Cloud Logging (the deck's latency line).
    if (process.env.NODE_ENV !== 'test') console.log(JSON.stringify({ severity: 'INFO', message: 'check_run', aiMode: check.aiMode, lines: check.lines.length, ms, msPerLine: Math.round(ms / Math.max(1, check.lines.length)), model: check.models.A }));
    res.json({ check });
  }));

  app.put('/api/projects/:id/periods/:period/percent', allow('engineer'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p || !requireWrite(req, res, p)) return;
    try {
      const entry = await A.setPercent({ store, project: p, period: req.params.period, value: (req.body || {}).value, user: req.user, narrative: (req.body || {}).narrative });
      res.json({ percentComplete: entry });
    } catch (e) {
      sendErr(res, e);
    }
  }));

  async function draftsFor(p, period) {
    const per = await store.get('periods', periodId(p.id, period));
    if (!per) return null;
    const users = await usersMap(store);
    const photos = (await store.find('photos', { projectId: p.id, period })).filter((x) => x.source !== 'transmittal').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const eff = effectiveDecisions(await store.find('decisions', { projectId: p.id }), [per]);
    const monitoring = await store.find('monitoring', { projectId: p.id });
    return buildDrafts({ project: p, period: per, photos, effective: eff, monitoring, inChargeName: (users[p.inChargeId] || {}).name || 'Unassigned', today: today() });
  }
  app.get('/api/projects/:id/periods/:period/reports', allow('engineer', 'reviewer'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p) return;
    const d = await draftsFor(p, req.params.period);
    if (!d) return res.status(400).json({ error: 'Enter the percent complete for this period first.' });
    res.json({ ...d, note: PHRASES.draftNotSent });
  }));
  app.get('/api/projects/:id/periods/:period/reports/:file', allow('engineer', 'reviewer'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p) return;
    const m = String(req.params.file).match(/^([A-Z_]+)\.(txt|csv|html)$/);
    if (!m || !PERIOD_REPORT_KINDS.includes(m[1])) return res.status(404).json({ error: 'Unknown report.' });
    const d = await draftsFor(p, req.params.period);
    if (!d) return res.status(400).json({ error: 'Enter the percent complete for this period first.' });
    const draft = d.drafts.find((x) => x.kind === m[1]);
    const name = `${p.id}_${req.params.period}_${m[1]}_DRAFT.${m[2]}`;
    if (m[2] === 'html') {
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self'");
      return res.type('html').send(toHtml(draft, d.fictional));
    }
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.type(m[2] === 'csv' ? 'text/csv' : 'text/plain').send(m[2] === 'csv' ? toCsv(draft, d.fictional) : toText(draft, d.fictional));
  }));

  app.post('/api/projects/:id/transmittals', allow('engineer', 'reviewer'), uploadGate, upload.single('photo'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p || !requireWrite(req, res, p)) return;
    const n = req.file ? 1 : 0;
    if (!(await reservePhotoSlots(n))) return res.status(403).json({ error: photoLimitMsg });
    try {
      const t = await A.logTransmittal({ store, photoStore, project: p, input: req.body || {}, user: req.user, photo: req.file || null, today: today() });
      if (n && !t.photoId) await releasePhotoSlots(n);
      res.json({ transmittal: t });
    } catch (e) {
      await releasePhotoSlots(n);
      sendErr(res, e);
    }
  }));
  app.get('/api/projects/:id/transmittals', allow(...STAFF_READ), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p) return;
    res.json((await store.find('transmittals', { projectId: p.id })).sort((a, b) => b.submittedOn.localeCompare(a.submittedOn)));
  }));

  app.post('/api/projects/:id/monitoring', allow('engineer', 'reviewer'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p || !requireWrite(req, res, p)) return;
    try {
      res.json({ entry: await A.logMonitoring({ store, project: p, user: req.user, entry: req.body || {} }) });
    } catch (e) {
      sendErr(res, e);
    }
  }));

  // A new contractor link. The token is shown once; only its hash is kept. The old link stops working.
  app.post('/api/projects/:id/contractor-link', allow('engineer'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p || !requireWrite(req, res, p)) return;
    const token = newToken();
    await store.update('projects', p.id, { contractorTokenHash: hashToken(token), contractorLinkCreatedAt: new Date().toISOString() });
    res.json({ link: `/c/${token}`, note: 'Copy this link now. It is not shown again. You send it to the contractor yourself.' });
  }));

  // A plain-language note drafted by Gemini from the decision log only. Nothing is sent; a person edits it.
  app.post('/api/projects/:id/periods/:period/draft-note', allow('engineer', 'reviewer'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p) return;
    try {
      const r = await draftNote({ store, rootStore, live, spend, judge: !!req.judge, config, project: p, period: req.params.period, audience: (req.body || {}).audience, today: today() });
      res.json(r);
    } catch (e) {
      res.status(e.status || 400).json({ error: e.message, needsCode: !!e.needsCode });
    }
  }));

  // ---------- reviewer ----------
  // The engineer in charge has the last word on each line; the office head (reviewer) can overrule.
  // Every decision is appended to the log, so both the AI default and each person's call are kept.
  app.post('/api/projects/:id/periods/:period/decisions', allow('engineer', 'reviewer'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p || !requireWrite(req, res, p)) return;
    try {
      const b = req.body || {};
      res.json({ decision: await A.decideLine({ store, project: p, period: req.params.period, lineKey: b.lineKey, decision: b.decision, reason: b.reason, user: req.user }) });
    } catch (e) {
      sendErr(res, e);
    }
  }));
  app.post('/api/projects/:id/periods/:period/flag-notes', allow('reviewer'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p) return;
    try {
      const b = req.body || {};
      res.json({ note: await A.explainFlag({ store, project: p, period: req.params.period, photoId: b.photoId, checkKey: b.checkKey, explanation: b.explanation, user: req.user }) });
    } catch (e) {
      sendErr(res, e);
    }
  }));

  app.get('/api/review/monday', allow('reviewer'), wrap(async (req, res) => {
    const t = today();
    const { snaps, users } = await allSnapshots(store, t, config.escalation);
    const wk = weekRange(t);
    const lagging = snaps
      .filter((s) => s.slippage)
      .map((s) => ({ ...projectSummary(s.project, s), lagging: s.slippage.points <= -config.escalation.laggingPoints }))
      .sort((a, b) => a.slippage.points - b.slippage.points);
    const reports = [];
    for (const s of snaps)
      for (const o of s.obligations) {
        const thisWeek = o.due >= wk.start && o.due <= wk.end;
        if (o.status === 'overdue' || (o.status === 'late' && o.recent) || (thisWeek && o.status !== 'on_time') || o.status === 'due_soon')
          reports.push({ projectId: s.project.id, projectName: s.project.name, inCharge: s.inChargeName, kind: o.kind, label: `${o.name}, ${periodKeyLabel(o.periodKey)}`, due: o.due, status: o.status, daysOverdue: o.daysOverdue || 0, daysLate: o.daysLate || 0, daysToDue: o.daysToDue });
      }
    reports.sort((a, b) => a.due.localeCompare(b.due));
    const monitoring = await store.find('monitoring', {});
    const credit = {};
    for (const m of monitoring) {
      const k = m.by.uid;
      credit[k] = credit[k] || { uid: k, name: m.by.name, entries: 0, hours: 0, onBehalf: 0 };
      credit[k].entries++;
      credit[k].hours += m.hours || 0;
      if (/contractor/i.test(m.kind)) credit[k].onBehalf++;
    }
    res.json({
      today: t,
      week: wk,
      lagging,
      reports,
      office: snaps.flatMap((s) => s.items.filter((i) => i.level >= 1)),
      queue: snaps.filter((s) => s.pendingReview > 0).map((s) => ({ projectId: s.project.id, projectName: s.project.name, inCharge: s.inChargeName, pending: s.pendingReview })),
      inCharge: snaps.map((s) => ({ projectId: s.project.id, projectName: s.project.name, inCharge: s.inChargeName, inChargeId: s.project.inChargeId })),
      credit: Object.values(credit).sort((a, b) => b.hours - a.hours),
      engineers: Object.values(users).filter((u) => u.role === 'engineer').map((u) => ({ id: u.id, name: u.name }))
    });
  }));

  app.get('/api/review/queue', allow('reviewer'), wrap(async (req, res) => {
    const { snaps } = await allSnapshots(store, today(), config.escalation);
    const out = [];
    for (const s of snaps)
      for (const per of s.data.periods.filter((x) => x.check)) {
        const pending = per.check.lines.filter((l) => !s.effective.has(`${per.period}|${l.lineKey}`)).length;
        if (pending) out.push({ projectId: s.project.id, projectName: s.project.name, period: per.period, label: monthLabel(per.period), pending, inCharge: s.inChargeName });
      }
    res.json(out.sort((a, b) => b.period.localeCompare(a.period)));
  }));

  app.get('/api/review/overrides', allow('reviewer', 'auditor'), wrap(async (req, res) => {
    const ds = (await store.find('decisions', {})).filter((d) => d.kind === 'line' && (d.overrode || d.readersDisagreed));
    res.json(ds.sort((a, b) => b.at.localeCompare(a.at)));
  }));

  // ---------- mayor: escalated items only ----------
  app.get('/api/mayor/escalations', allow('mayor'), wrap(async (req, res) => {
    const { snaps } = await allSnapshots(store, today(), config.escalation);
    const items = snaps.flatMap((s) => s.items.filter((i) => i.level >= 2)).map((i) => ({ projectName: i.projectName, kind: i.kind, plain: i.plain, personInCharge: i.inCharge }));
    res.json({ today: today(), escalated: items.length, gauge: items.length === 0 ? 'dark' : items.length < 3 ? 'amber' : 'red', items });
  }));

  // ---------- auditor: read-only logs ----------
  async function auditLog(p) {
    const [decisions, transmittals, submissions, periods, monitoring] = await Promise.all([
      store.find('decisions', { projectId: p.id }),
      store.find('transmittals', { projectId: p.id }),
      store.find('submissions', { projectId: p.id }),
      store.find('periods', { projectId: p.id }),
      store.find('monitoring', { projectId: p.id })
    ]);
    return {
      project: { id: p.id, name: p.name, contractId: p.contractId, contractor: p.contractor, fictional: !!p.fictional },
      decisions: decisions.sort((a, b) => b.at.localeCompare(a.at)),
      transmittals: transmittals.sort((a, b) => b.submittedOn.localeCompare(a.submittedOn)),
      submissions: submissions.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)),
      percentEntries: periods.flatMap((x) => (x.percentHistory || []).map((e) => ({ period: x.period, ...e }))).sort((a, b) => b.enteredAt.localeCompare(a.enteredAt)),
      checkRuns: periods.filter((x) => x.check).map((x) => ({ period: x.period, runId: x.check.runId, runAt: x.check.runAt, runBy: x.check.runBy, aiMode: x.check.aiMode, models: x.check.models })),
      monitoring: monitoring.sort((a, b) => b.date.localeCompare(a.date))
    };
  }
  app.get('/api/audit/projects', allow('auditor', 'reviewer'), wrap(async (req, res) => {
    const ps = await store.find('projects', {});
    res.json(ps.sort((a, b) => a.id.localeCompare(b.id)).map((p) => ({ id: p.id, name: p.name, contractId: p.contractId })));
  }));
  app.get('/api/audit/projects/:id/log', allow('auditor', 'reviewer'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p) return;
    res.json(await auditLog(p));
  }));
  app.get('/api/audit/projects/:id/log.csv', allow('auditor', 'reviewer'), wrap(async (req, res) => {
    const p = await loadProject(req, res);
    if (!p) return;
    const L = await auditLog(p);
    const rows = [['when', 'type', 'period', 'item', 'detail', 'who', 'role']];
    for (const d of L.decisions)
      rows.push([d.at, d.kind === 'line' ? 'line decision' : 'flag explanation', d.period, d.lineLabel || d.checkKey, d.kind === 'line' ? `decided ${d.decision}; readers ${d.readerA}/${d.readerB}; default ${d.aiDefault}${d.overrode ? '; override' : ''}; reason: ${d.reason}` : d.reason, d.by.name, d.by.role]);
    for (const t of L.transmittals) rows.push([t.loggedAt, 'report submitted', t.periodKey, t.reportName, `submitted ${t.submittedOn} to ${t.to}; due ${t.due}${t.late ? `; LATE by ${t.daysLate} day(s), not counted as on time` : '; on time'}`, t.loggedBy.name, t.loggedBy.role]);
    for (const s of L.submissions) rows.push([s.receivedAt, 'contractor submission', s.period, `${s.claims.length} line(s), ${s.photoIds.length} photo(s)`, s.note, 'Contractor (project link)', 'contractor']);
    for (const e of L.percentEntries) rows.push([e.enteredAt, 'percent complete entered', e.period, `${e.value}%`, '', e.enteredByName, 'engineer']);
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n');
    res.setHeader('Content-Disposition', `attachment; filename="${p.id}_audit_log.csv"`);
    res.type('text/csv').send(`${csv}\n`);
  }));

  // ---------- photos ----------
  app.get('/api/photos/:photoId', allow(...STAFF_READ), wrap(async (req, res) => {
    const ph = await store.get('photos', req.params.photoId);
    if (!ph) return res.status(404).json({ error: 'No such photo.' });
    const got = await photoStore.get(ph.storageKey);
    if (!got) return res.status(404).json({ error: 'Photo file missing.' });
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.type(got.contentType).send(got.buffer);
  }));

  // ---------- contractor: per-project link ----------
  async function projectByToken(req, res) {
    const tok = String(req.params.token || '');
    if (tok.length < 8) {
      res.status(404).json({ error: 'This link is not valid.' });
      return null;
    }
    const ps = await store.find('projects', { contractorTokenHash: hashToken(tok) });
    if (!ps.length) {
      res.status(404).json({ error: 'This link is not valid or has been replaced. Ask the municipal engineering office for a new one.' });
      return null;
    }
    return ps[0];
  }
  // What the contractor sees: their project, the lines, and the status of what they sent. Never verdicts.
  app.get('/api/contractor/:token', wrap(async (req, res) => {
    const p = await projectByToken(req, res);
    if (!p) return;
    const subs = (await store.find('submissions', { projectId: p.id })).filter((s) => s.source === 'contractor').sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const periods = await store.find('periods', { projectId: p.id });
    const status = (s) => {
      const per = periods.find((x) => x.period === s.period);
      if (!per || !per.check) return 'Received. Waiting for the office to check it.';
      return 'Received. The office has looked at it.';
    };
    const t = today();
    const lastClosed = new Date(Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 2, 1)).toISOString().slice(0, 7);
    res.json({
      project: { name: p.name, location: p.location, contractor: p.contractor, contractId: p.contractId },
      suggestedPeriod: lastClosed,
      lines: p.lines.map((l) => ({ key: l.key, label: l.label, status: l.status || null })),
      milestones: p.milestones,
      submissions: subs.map((s) => ({ id: s.id, period: s.period, periodLabel: monthLabel(s.period), receivedAt: s.receivedAt, lines: s.claims.length, photos: s.photoIds.length, status: status(s) })),
      note: 'Send your progress claim (percent complete per line item) and milestone photos here. Keep the photos as they came off the camera or phone; date and location are useful but not required.'
    });
  }));
  // The link is checked before any file is read; a valid submission then gets its own copy of the demo.
  const contractorGate = wrap(async (req, res, next) => {
    if (await projectByToken(req, res)) next();
  });
  app.post('/api/contractor/:token/submissions', contractorGate, uploadGate, upload.array('photos', 8), wrap(async (req, res) => {
    // Everything is checked against the seeded project first; only a valid submission gets a copy.
    let claims = [];
    try {
      claims = JSON.parse((req.body && req.body.claims) || '[]');
    } catch (e) {
      return res.status(400).json({ error: 'Claims could not be read.' });
    }
    const period = String((req.body || {}).period || '');
    try {
      const before = await projectByToken(req, res);
      if (!before) return;
      await A.validateContractorSubmission({ project: before, period, claims, files: req.files || [] });
      await req.ensureWorkspace();
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
    const p = await projectByToken(req, res);
    if (!p) return;
    const n = (req.files || []).length;
    if (!(await reservePhotoSlots(n))) return res.status(403).json({ error: photoLimitMsg });
    try {
      const s = await A.contractorSubmit({ store, photoStore, project: p, period, claims, files: req.files || [], note: (req.body || {}).note });
      if (s.photoIds.length < n) await releasePhotoSlots(n - s.photoIds.length);
      res.json({ received: true, id: s.id, receivedAt: s.receivedAt, lines: s.claims.length, photos: s.photoIds.length, status: 'Received. Waiting for the office to check it.' });
    } catch (e) {
      await releasePhotoSlots(n);
      sendErr(res, e);
    }
  }));

  // ---------- public ----------
  async function publicFor(id) {
    const p = await store.get('projects', id);
    if (!p) return null;
    const periods = await store.find('periods', { projectId: id });
    const eff = effectiveDecisions(await store.find('decisions', { projectId: id }), periods);
    const { latestPercent } = require('./domain/progress');
    return { note: publicNote({ project: p, periods, effective: eff, latest: latestPercent(periods) }), periods, eff, p };
  }
  app.get('/api/public/projects', wrap(async (req, res) => {
    const ps = await store.find('projects', {});
    const out = [];
    for (const p of ps.sort((a, b) => a.id.localeCompare(b.id))) out.push((await publicFor(p.id)).note);
    res.json(out);
  }));
  app.get('/api/public/projects/:id', wrap(async (req, res) => {
    const r = await publicFor(req.params.id);
    if (!r) return res.status(404).json({ error: 'No such project.' });
    res.json(r.note);
  }));
  app.get('/api/public/projects/:id/photo', wrap(async (req, res) => {
    const r = await publicFor(req.params.id);
    if (!r) return res.status(404).end();
    const per = r.periods.filter((x) => x.check && x.check.photoIds && x.check.photoIds.length && x.check.lines.some((l) => r.eff.has(`${x.period}|${l.lineKey}`))).sort((a, b) => b.period.localeCompare(a.period))[0];
    if (!per) return res.status(404).end();
    const ph = await store.get('photos', per.check.photoIds[0]);
    const got = ph && (await photoStore.get(ph.storageKey));
    if (!got) return res.status(404).end();
    res.type(got.contentType).send(got.buffer);
  }));

  // ---------- owner view and schedule trajectory (src/routes/owner.js) ----------
  require('./routes/owner')(app, { store, allow, wrap, today, config });

  // ---------- test support (off unless ALLOW_TEST_RESET=1) ----------
  if (config.allowTestReset) {
    app.post('/api/test/reset', wrap(async (req, res) => {
      await reseed();
      res.json({ ok: true });
    }));
  }

  // ---------- pages ----------
  const page = (file) => {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    return raw.replace(/\{\{PRODUCT_NAME\}\}/g, PRODUCT_NAME).replace(/\{\{BRAND_DISPLAY\}\}/g, BRAND_DISPLAY).replace(/\{\{BRAND\}\}/g, BRAND);
  };
  const sendPage = (res, file) => res.type('html').send(page(file));
  app.use('/static', express.static(path.join(PUBLIC_DIR, 'static'), { maxAge: '5m' }));
  app.get('/', (req, res) => (req.user ? res.redirect(`/${req.user.role}`) : sendPage(res, 'login.html')));
  for (const role of ['engineer', 'reviewer', 'mayor', 'auditor']) {
    app.get(`/${role}`, (req, res) => {
      if (!req.user || req.user.role !== role) return res.redirect('/');
      sendPage(res, `${role}.html`);
    });
  }
  app.get('/c/:token', (req, res) => sendPage(res, 'contractor.html'));
  app.get(['/public', '/public/:id'], (req, res) => sendPage(res, 'public.html'));

  // ---------- errors ----------
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Photos must be under ${config.maxUploadMb} MB.` : 'Upload problem.' });
    if (err instanceof A.UserError) return res.status(err.status).json({ error: err.message });
    if (err.code === 'TEMPLATE_READONLY') return res.status(403).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    console.error(err);
    res.status(500).json({ error: neutralize('Something went wrong on the server.') });
  });
  return app;
}

module.exports = { createApp };
