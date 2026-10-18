// Demo authentication, kept simple and honest:
// - Staff pick a demo user; the server sets an HMAC-signed, httpOnly session cookie.
// - Every API route declares the roles it allows; the check happens on the server.
// - Contractors use a per-project link with a random token; only its SHA-256 hash is stored.
// - Public routes need nothing and expose only the public progress note.
// Real sign-in (Identity Platform or Google sign-in) replaces only login and readSession: see README.
const crypto = require('crypto');

const COOKIE = 'pop_session';
const ROLES = ['engineer', 'reviewer', 'mayor', 'auditor'];

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sign(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const mac = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${mac}`;
}
function verify(token, secret) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const want = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(mac);
  const b = Buffer.from(want);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch (e) {
    return null;
  }
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function hashToken(t) {
  return crypto.createHash('sha256').update(String(t)).digest('hex');
}
function newToken() {
  return b64url(crypto.randomBytes(24));
}

function authMiddleware({ config, store }) {
  return async (req, res, next) => {
    req.user = null;
    const p = verify(parseCookies(req.headers.cookie)[COOKIE], config.sessionSecret);
    if (p && p.uid) {
      const u = await store.get('users', p.uid);
      if (u && u.role === p.role) req.user = u;
    }
    next();
  };
}

// cookiePath is the path the app is served under ('/' on its own host, '/builderscup' behind cernen.com),
// so the session cookie is sent only to this app.
function setSession(res, user, config, secure, cookiePath = '/') {
  const exp = Date.now() + config.sessionHours * 3600 * 1000;
  const tok = sign({ uid: user.id, role: user.role, exp }, config.sessionSecret);
  res.append('Set-Cookie', `${COOKIE}=${tok}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${config.sessionHours * 3600}${secure ? '; Secure' : ''}`);
}
function clearSession(res, cookiePath = '/') {
  res.append('Set-Cookie', `${COOKIE}=; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Route guard. Usage: allow('engineer', 'reviewer').
function allow(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in first.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: `This is not available to the ${req.user.role} role.` });
    next();
  };
}

// State-changing requests must carry a custom header. Browsers cannot add it cross-site without a
// CORS preflight, which this service never grants, so it blocks cross-site form posts.
function requireAppHeader(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-pop-request') !== '1') return res.status(403).json({ error: 'Missing request header.' });
  next();
}

module.exports = { COOKIE, ROLES, sign, verify, hashToken, newToken, authMiddleware, setSession, clearSession, allow, requireAppHeader, parseCookies };
