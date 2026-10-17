// Acceptance check against a deployed service (real Firestore). Makes no live model calls (no access
// code is used), so it costs nothing beyond a few Firestore reads and writes.
//   node scripts/acceptance.js https://<service-url>
// Checks: pages and API up; anonymous visitors read the seeded demo without creating a copy; two
// visitors get separate copies; a decision in one copy is not visible in the other; switching roles
// keeps the copy; April 2026 opens on a saved Gemini run; live runs are refused without the code.
const assert = require('node:assert/strict');

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
    assert.equal((await anon.call('GET', '/healthz')).status, 200);
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
  console.log(results.join('\n'));
  process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
})();
