// The app served under a path prefix as well as at / (BASE_PATH=/builderscup, as behind cernen.com),
// and the visitor address passed by the cernen.com proxy (PROXY_SECRET).
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('../helpers');

const P = '/builderscup';
let S;
test.before(async () => {
  S = await startServer({ BASE_PATH: P, PROXY_SECRET: 'proxy-test-secret', WORKSPACES: '1', JUDGE_CODE: 'judge-test-code' });
});
test.after(async () => S.close());

const cookies = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : []);
const pair = (c) => c.split(';')[0];

test('pages under the prefix point at prefixed assets; the root still points at the root', async () => {
  for (const p of [P, `${P}/`]) {
    const r = await S.call('GET', p);
    assert.equal(r.status, 200, p);
    assert.match(r.text, /<meta name="pop-base" content="\/builderscup">/);
    assert.match(r.text, /href="\/builderscup\/static\/styles\.css"/);
    assert.match(r.text, /src="\/builderscup\/static\/common\.js"/);
    assert.doesNotMatch(r.text, /\{\{BASE\}\}/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  }
  const root = await S.call('GET', '/');
  assert.equal(root.status, 200);
  assert.match(root.text, /<meta name="pop-base" content="">/);
  assert.match(root.text, /href="\/static\/styles\.css"/);
});

test('static files and the API answer under the prefix with the right caching', async () => {
  const js = await S.call('GET', `${P}/static/common.js`);
  assert.equal(js.status, 200);
  assert.match(js.headers.get('cache-control'), /public, max-age=300/);
  const m = await S.call('GET', `${P}/api/meta`);
  assert.equal(m.status, 200);
  assert.equal(m.headers.get('cache-control'), 'no-store');
  assert.ok(m.json.demoContractorLinks.length > 0);
  for (const l of m.json.demoContractorLinks) assert.ok(l.link.startsWith(`${P}/c/`), l.link);
  const rootMeta = await S.call('GET', '/api/meta');
  for (const l of rootMeta.json.demoContractorLinks) assert.ok(l.link.startsWith('/c/'), l.link);
});

test('sign-in under the prefix: cookies scoped to the prefix, prefixed home and redirects', async () => {
  const r = await S.call('POST', `${P}/api/auth/login`, { body: { userId: 'eng-ana' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.home, `${P}/engineer`);
  const set = cookies(r);
  assert.ok(set.length >= 2, 'session and workspace cookies');
  for (const c of set) assert.match(c, /; Path=\/builderscup;/, c);
  const jar = set.map(pair).join('; ');

  const home = await S.call('GET', `${P}/`, { cookie: jar });
  assert.equal(home.status, 302);
  assert.equal(home.headers.get('location'), `${P}/engineer`);
  for (const p of [`${P}/engineer`, `${P}/engineer/`]) assert.equal((await S.call('GET', p, { cookie: jar })).status, 200, p);
  const wrongRole = await S.call('GET', `${P}/mayor`, { cookie: jar });
  assert.equal(wrongRole.status, 302);
  assert.equal(wrongRole.headers.get('location'), `${P}/`);
  const anon = await S.call('GET', `${P}/engineer`);
  assert.equal(anon.headers.get('location'), `${P}/`);

  // Photo addresses in API answers carry the prefix and load through it.
  const per = await S.call('GET', `${P}/api/projects/P-001/periods/2026-04`, { cookie: jar });
  assert.equal(per.status, 200);
  assert.ok(per.json.photos.length > 0);
  for (const ph of per.json.photos) assert.ok(ph.url.startsWith(`${P}/api/photos/`), ph.url);
  const img = await S.call('GET', per.json.photos[0].url, { cookie: jar });
  assert.equal(img.status, 200);
  assert.match(img.headers.get('cache-control'), /^private/);

  const link = await S.call('POST', `${P}/api/projects/P-001/contractor-link`, { cookie: jar });
  assert.equal(link.status, 200);
  assert.ok(link.json.link.startsWith(`${P}/c/`), link.json.link);

  const out = await S.call('POST', `${P}/api/auth/logout`, { cookie: jar });
  assert.equal(out.status, 200);
  assert.match(cookies(out)[0], /; Path=\/builderscup;.*Max-Age=0/);
});

test('sign-in at the root keeps root cookies and links', async () => {
  const r = await S.call('POST', '/api/auth/login', { body: { userId: 'eng-carlo' } });
  assert.equal(r.json.home, '/engineer');
  for (const c of cookies(r)) assert.match(c, /; Path=\/;/, c);
});

test('unknown paths under the prefix are 404 and do not fall through to the root', async () => {
  assert.equal((await S.call('GET', `${P}/nope`)).status, 404);
  const api = await S.call('GET', `${P}/api/nope`);
  assert.equal(api.status, 404);
  assert.equal(api.json.error, 'Not found.');
  const bad = await fetch(`${S.base}${P}/api/auth/login`, { method: 'POST', headers: { 'x-pop-request': '1', 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'Request body is not valid JSON.');
  assert.equal((await S.call('POST', `${P}/api/auth/logout`, { headers: { 'x-pop-request': '' } })).status, 403);
});

test('the visitor address is taken from the proxy only with the shared secret', async () => {
  const tryCode = (headers) => S.call('POST', `${P}/api/access`, { body: { code: 'wrong' }, headers });
  // With the secret, each named visitor has their own 20 tries.
  for (let i = 0; i < 25; i++) assert.equal((await tryCode({ 'x-cernen-proxy': 'proxy-test-secret', 'x-cernen-client-ip': `198.51.100.${i}` })).status, 403);
  // Without it the header is ignored: all these count against the one connecting address.
  const got = [];
  for (let i = 0; i < 21; i++) got.push((await tryCode({ 'x-cernen-proxy': 'not-the-secret', 'x-cernen-client-ip': `203.0.113.${i}` })).status);
  assert.deepEqual(got.slice(0, 20), Array(20).fill(403));
  assert.equal(got[20], 429);
  // The right code still works for a named visitor, and the judge cookie is scoped to the prefix.
  const ok = await S.call('POST', `${P}/api/access`, { body: { code: 'judge-test-code' }, headers: { 'x-cernen-proxy': 'proxy-test-secret', 'x-cernen-client-ip': '192.0.2.7' } });
  assert.equal(ok.status, 200);
  assert.match(cookies(ok)[0], /; Path=\/builderscup;/);
});
