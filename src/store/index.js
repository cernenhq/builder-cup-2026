// Storage interface. Every adapter provides:
//   get(collection, id)            -> document or null
//   set(collection, id, doc)       -> overwrite
//   update(collection, id, patch)  -> shallow merge
//   add(collection, doc)           -> id (doc.id is used when present)
//   find(collection, {field: value, ...}) -> documents matching all equality filters
//   bulkSet(collection, docs)      -> write many documents (each has an id)
//   clear()                        -> remove everything (tests and re-seeding only)
//   close()
//   scope(ws)                      -> (root adapter only) the same interface over one workspace
// Workspace collections: users, projects, periods, photos, submissions, decisions, transmittals,
// monitoring, meta, aicache, notecache (answers generated in that copy). Shared on the root: spend,
// aicache and notecache (the saved seed runs), workspaces, limits.
// See README "Data model".
const { createMemoryStore } = require('./memory');
const { createFirestoreStore, COLLECTIONS } = require('./firestore');
const { als, MAIN, TEMPLATE } = require('../workspace');

function createRootStore(config) {
  if (config.store === 'firestore') {
    return createFirestoreStore({ projectId: config.firestoreProjectId, databaseId: config.firestoreDatabaseId, prefix: process.env.FIRESTORE_PREFIX || '', ttlHours: config.workspaceHours });
  }
  return createMemoryStore();
}

const WRITES = new Set(['set', 'update', 'add', 'bulkSet', 'clear']);

// The store the app uses: every call goes to the current request's workspace. The seeded demo
// ("template") is read-only for requests; only seeding (outside a request) writes to it.
function createScopedStore(root, fallbackWs = MAIN) {
  const cache = new Map();
  const s = () => {
    const ctx = als.getStore() || {};
    const ws = ctx.ws || fallbackWs;
    if (!cache.has(ws)) {
      if (cache.size > 2000) cache.clear();
      cache.set(ws, root.scope(ws, { expiresAt: ctx.expiresAt || null }));
    }
    return cache.get(ws);
  };
  const out = { kind: root.kind, root };
  for (const m of ['get', 'set', 'update', 'add', 'find', 'bulkSet', 'clear']) {
    out[m] = (...a) => {
      const ctx = als.getStore() || {};
      if (WRITES.has(m) && ctx.request && (ctx.ws || fallbackWs) === TEMPLATE) {
        const e = new Error('Sign in to get your own copy of the demo before changing anything.');
        e.code = 'TEMPLATE_READONLY';
        e.status = 403;
        return Promise.reject(e);
      }
      return s()[m](...a);
    };
  }
  out.close = () => root.close();
  return out;
}

module.exports = { createRootStore, createScopedStore, COLLECTIONS };
