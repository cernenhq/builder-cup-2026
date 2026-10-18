// Acceptance check against a deployed service (real Firestore). Makes no billed model calls: without
// ACCEPT_JUDGE_CODE nothing live runs; with it, the only live attempt is one that must be refused for
// size BEFORE anything is reserved or sent.
//   node scripts/acceptance.js https://<service-url>
//   read -s ACCEPT_JUDGE_CODE && export ACCEPT_JUDGE_CODE && node scripts/acceptance.js https://<service-url>
// Also exercises, on real Firestore: a check going stale when claims change; a check racing a claims
// edit never ends up current on old claims; the per-copy photo limit under simultaneous uploads.
// Checks: pages and API up; anonymous visitors read the seeded demo without creating a copy; two
// visitors get separate copies; a decision in one copy is not visible in the other; switching roles
// keeps the copy; April 2026 opens on a saved Gemini run; live runs are refused without the code.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) throw new Error('Usage: node scripts/acceptance.js <url>');

function visitor() {
  const jar = new Map();
  return {
    jar,
    async call(method, p, body) {
      const headers = { 'x-pop-request': '1', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') };
      if (body !== undefined) headers['content-type'] = 'application/json';
      const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
      for (const c of r.headers.getSetCookie()) {
        const [kv] = c.split(';');
        const i = kv.indexOf('=');
        if (/Max-Age=0/.test(c)) jar.delete(kv.slice(0, i));
        else jar.set(kv.slice(0, i), kv.slice(i + 1));
      }
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (e) {
        json = null;
      }
      return { status: r.status, json, text };
    },
    async upload(p, files) {
      const fd = new FormData();
      for (const f of files) fd.append('photos', new Blob([f.buffer], { type: 'image/jpeg' }), f.name);
      const r = await fetch(base + p, { method: 'POST', headers: { 'x-pop-request': '1', cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }, body: fd });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch (e) {
        json = null;
      }
      return { status: r.status, json, text };
    }
  };
}

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`PASS ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
  }
}

(async () => {
  const anon = visitor();
  await step('health and sign-in page', async () => {
    assert.equal((await anon.call('GET', '/health')).status, 200);
    assert.match((await anon.call('GET', '/')).text, /Sign in/);
  });
  await step('anonymous read of the seeded demo creates no copy', async () => {
    const r = await anon.call('GET', '/api/public/projects');
    assert.equal(r.status, 200);
    assert.ok(r.json.length >= 3);
    assert.ok(!anon.jar.has('pop_ws'));
    const m = await anon.call('GET', '/api/meta');
    assert.equal(m.json.access.judge, false);
    assert.equal(m.json.store, 'firestore');
  });
  const a = visitor();
  const b = visitor();
  await step('two visitors get separate copies', async () => {
    assert.equal((await a.call('POST', '/api/auth/login', { userId: 'eng-ana' })).status, 200);
    assert.equal((await b.call('POST', '/api/auth/login', { userId: 'eng-ana' })).status, 200);
    assert.ok(a.jar.get('pop_ws') && b.jar.get('pop_ws') && a.jar.get('pop_ws') !== b.jar.get('pop_ws'));
  });
  await step('April 2026 opens on a saved Gemini run', async () => {
    const r = await a.call('GET', '/api/projects/P-001/periods/2026-04');
    assert.equal(r.status, 200);
    assert.equal(r.json.check.aiMode, 'saved', `aiMode ${r.json.check.aiMode}`);
    assert.ok(r.json.check.savedRun && r.json.check.savedRun.model);
  });
  const reason = `Acceptance ${Date.now()}`;
  // April 2026 lines in the seed: ca, re, ho, rw. Use 're' (Rooftop level enclosure) and pick a verdict
  // different from its current AI default, so the decision is an override and shows in the history.
  const LINE = 're';
  await step('a decision in one copy is invisible in the other', async () => {
    const before = await a.call('GET', '/api/projects/P-001/periods/2026-04');
    assert.equal(before.status, 200, before.text);
    const line = before.json.check.lines.find((l) => l.lineKey === LINE);
    assert.ok(line, `line ${LINE} not in April 2026`);
    const decision = line.aiDefault === 'contradicted' ? 'supported' : 'contradicted';
    const d = await a.call('POST', '/api/projects/P-001/periods/2026-04/decisions', { lineKey: LINE, decision, reason });
    assert.equal(d.status, 200, d.text);
    assert.equal(d.json.decision.overrode, true, `aiDefault ${line.aiDefault}, decided ${decision}`);
    const seenA = await a.call('GET', '/api/projects/P-001/periods/2026-04');
    assert.equal(seenA.json.check.lines.find((l) => l.lineKey === LINE).decision.reason, reason);
    const seenB = await b.call('GET', '/api/projects/P-001/periods/2026-04');
    const lb = seenB.json.check.lines.find((l) => l.lineKey === LINE);
    assert.ok(!lb.decision || lb.decision.reason !== reason);
  });
  await step('switching roles keeps the copy', async () => {
    await a.call('POST', '/api/auth/logout');
    assert.equal((await a.call('POST', '/api/auth/login', { userId: 'rev-benita' })).status, 200);
    const r = await a.call('GET', '/api/review/overrides');
    assert.equal(r.status, 200);
    assert.ok(r.json.some((x) => x.reason === reason));
  });
  await step('the Monday view data loads', async () => {
    const r = await a.call('GET', '/api/owner/projects/P-001/trajectory');
    assert.equal(r.status, 200, r.text);
  });
  await step('a live run is refused without the access code (no model call)', async () => {
    // P-001 May has no photo in the seeded copy; upload nothing and run: rule checks only, no live reader.
    const r = await b.call('POST', '/api/projects/P-001/periods/2026-04/draft-note', { audience: 'mayor' });
    assert.ok([200, 403].includes(r.status), `status ${r.status}`);
    if (r.status === 200) assert.equal(r.json.saved, true, 'only a saved draft may come back without the code');
    else assert.equal(r.json.needsCode, true);
  });
  // ---- stale checks on real Firestore ----
  const c = visitor();
  await step('changing claims marks the check stale; deciding is refused until it is re-run', async () => {
    assert.equal((await c.call('POST', '/api/auth/login', { userId: 'eng-ana' })).status, 200);
    const per = await c.call('GET', '/api/projects/P-001/periods/2026-04');
    const claims = per.json.claims.map((x) => ({ lineKey: x.lineKey, claimedPct: x.claimedPct === 100 ? 95 : 100 }));
    assert.equal((await c.call('PUT', '/api/projects/P-001/periods/2026-04/claims', { claims })).status, 200);
    const after = await c.call('GET', '/api/projects/P-001/periods/2026-04');
    assert.equal(after.json.checkStale, true);
    const d = await c.call('POST', '/api/projects/P-001/periods/2026-04/decisions', { lineKey: 're', decision: 'supported', reason: 'Visible in the photo' });
    assert.equal(d.status, 400);
    assert.equal((await c.call('POST', '/api/projects/P-001/periods/2026-04/check', {})).status, 200);
    assert.equal((await c.call('GET', '/api/projects/P-001/periods/2026-04')).json.checkStale, false);
  });
  await step('a check racing a claims edit never ends up current on the old claims (5 races)', async () => {
    for (let i = 0; i < 5; i++) {
      const pct = 60 + i;
      const cur = await c.call('GET', '/api/projects/P-001/periods/2026-04');
      const claims = cur.json.claims.map((x) => ({ lineKey: x.lineKey, claimedPct: pct }));
      await Promise.all([c.call('POST', '/api/projects/P-001/periods/2026-04/check', {}), c.call('PUT', '/api/projects/P-001/periods/2026-04/claims', { claims })]);
      const per = (await c.call('GET', '/api/projects/P-001/periods/2026-04')).json;
      const mismatch = per.check.lines.some((l) => (per.claims.find((x) => x.lineKey === l.lineKey) || {}).claimedPct !== l.claimedPct);
      if (mismatch) assert.equal(per.checkStale, true, `race ${i}: check is on old claims but not marked stale`);
    }
  });

  // ---- photo limit under simultaneous uploads on real Firestore ----
  await step('the per-copy photo limit holds under simultaneous uploads', async () => {
    const u = visitor();
    assert.equal((await u.call('POST', '/api/auth/login', { userId: 'eng-ana' })).status, 200);
    const buf = fs.readFileSync(path.join(__dirname, '..', 'seed-photos', 'p11.jpg'));
    const batch = (k) => Array.from({ length: 5 }, (_, j) => ({ buffer: buf, name: `acceptance-${k}-${j}.jpg` }));
    let accepted = 0;
    let refused = 0;
    const one = async (k) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const r = await u.upload('/api/projects/P-001/periods/2026-05/photos', batch(k));
        if (r.status === 503) {
          await new Promise((res) => setTimeout(res, 300 + Math.random() * 400));
          continue;
        }
        if (r.status === 200) accepted += r.json.photos.length;
        else if (r.status === 403) refused++;
        else throw new Error(`upload ${k}: ${r.status} ${r.text.slice(0, 120)}`);
        return;
      }
      throw new Error(`upload ${k}: still busy after retries`);
    };
    await Promise.all(Array.from({ length: 12 }, (_, k) => one(k)));
    const may = (await u.call('GET', '/api/projects/P-001/periods/2026-05')).json.photos.length;
    console.log(`  photo limit: ${accepted} accepted in 12 batches of 5, ${refused} batches refused; May now holds ${may}`);
    assert.ok(refused >= 1, 'some batches must be refused at the limit');
    assert.equal(may, accepted, 'every accepted photo is stored, no more');
    assert.ok(accepted <= 49, `accepted ${accepted}: the copy starts with 11 photos and holds at most 60`);
  });

  // ---- size limit is checked before any reservation (needs the code; makes no billed call) ----
  if (process.env.ACCEPT_JUDGE_CODE) {
    await step('an oversized live request is refused before anything is reserved or sent', async () => {
      const j = visitor();
      assert.equal((await j.call('POST', '/api/access', { code: process.env.ACCEPT_JUDGE_CODE })).status, 200);
      assert.equal((await j.call('POST', '/api/auth/login', { userId: 'eng-ana' })).status, 200);
      const per = await j.call('GET', '/api/projects/P-001/periods/2026-04');
      const claims = per.json.claims.map((x) => ({ lineKey: x.lineKey, claimedPct: x.claimedPct, statement: x.lineKey === 're' ? `Rooftop ${'x'.repeat(320)}` : x.statement, question: x.question }));
      assert.equal((await j.call('PUT', '/api/projects/P-001/periods/2026-04/claims', { claims })).status, 200);
      const r = await j.call('POST', '/api/projects/P-001/periods/2026-04/check', {});
      assert.equal(r.status, 200);
      const errs = Object.values(r.json.check.readerErrors || {}).join(' ');
      assert.match(errs, /under 300 characters/, `reader errors: ${errs}`);
    });
  } else results.push('SKIP oversized live request (set ACCEPT_JUDGE_CODE to run it; it makes no billed call)');

  console.log(results.join('\n'));
  process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
})();
