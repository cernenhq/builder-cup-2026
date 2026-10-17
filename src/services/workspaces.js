// Visitor workspaces: a private copy of the seeded demo per visitor, with a daily creation cap.
// The workspace id travels in its own signed cookie (pop_ws), separate from the sign-in, so a visitor
// can switch roles (engineer, office head, mayor) and keep working on the same copy.
const crypto = require('crypto');
const { sign, verify, parseCookies } = require('../auth');
const { COLLECTIONS } = require('../store');
const { TEMPLATE } = require('../workspace');

const WS_COOKIE = 'pop_ws';
const JUDGE_COOKIE = 'pop_judge';

function createWorkspaces({ rootStore, config, dayFn }) {
  // One creation at a time in this instance; the daily counter itself is a transaction (see createNow).
  let chain = Promise.resolve();
  function create() {
    const run = chain.then(createNow, createNow);
    chain = run.catch(() => {});
    return run;
  }
  async function createNow() {
    const day = dayFn();
    // A transaction on the shared daily counter, so separate instances cannot both take the last place.
    const ok = await rootStore.transact('limits', `day_${day}`, (cur) => {
      const n = (cur && cur.workspaces) || 0;
      if (n >= config.workspacesPerDay) return { result: false };
      return { doc: { workspaces: n + 1 }, result: true };
    });
    if (!ok) {
      const e = new Error('The demo has reached today\'s limit of new visitor copies. You can still look around; please try again tomorrow.');
      e.status = 429;
      throw e;
    }
    const id = `w${crypto.randomBytes(9).toString('hex')}`;
    const expiresAt = new Date(Date.now() + config.workspaceHours * 3600 * 1000).toISOString();
    const from = rootStore.scope(TEMPLATE);
    const to = rootStore.scope(id, { expiresAt });
    for (const name of COLLECTIONS.filter((c) => !['aicache', 'notecache'].includes(c))) {
      const docs = await from.find(name, {});
      if (docs.length) await to.bulkSet(name, docs);
    }
    // expireAt (a date) lets the same TTL policy delete this record; expiresAt is the readable copy.
    await rootStore.set('workspaces', id, { createdAt: new Date().toISOString(), expiresAt, expireAt: rootStore.kind === 'firestore' ? new Date(expiresAt) : expiresAt });
    return { id, expiresAt };
  }

  function read(req) {
    const p = verify(parseCookies(req.headers.cookie)[WS_COOKIE], config.sessionSecret);
    return p && p.ws ? { id: p.ws, expiresAt: new Date(p.exp).toISOString() } : null;
  }
  function write(res, ws, secure) {
    const exp = new Date(ws.expiresAt).getTime();
    res.append('Set-Cookie', `${WS_COOKIE}=${sign({ ws: ws.id, exp }, config.sessionSecret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((exp - Date.now()) / 1000))}${secure ? '; Secure' : ''}`);
  }

  function readJudge(req) {
    const p = verify(parseCookies(req.headers.cookie)[JUDGE_COOKIE], config.sessionSecret);
    return !!(p && p.judge);
  }
  function writeJudge(res, secure) {
    const days = 21;
    res.append('Set-Cookie', `${JUDGE_COOKIE}=${sign({ judge: true, exp: Date.now() + days * 86400000 }, config.sessionSecret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${days * 86400}${secure ? '; Secure' : ''}`);
  }
  function codeMatches(code) {
    if (!config.judgeCode) return false;
    const a = crypto.createHash('sha256').update(String(code || '')).digest();
    const b = crypto.createHash('sha256').update(config.judgeCode).digest();
    return crypto.timingSafeEqual(a, b);
  }

  return { create, read, write, readJudge, writeJudge, codeMatches };
}

module.exports = { createWorkspaces, WS_COOKIE, JUDGE_COOKIE };
