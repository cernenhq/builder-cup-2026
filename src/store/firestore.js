// Firestore adapter. Uses only equality filters, which Firestore serves from its automatic
// single-field indexes, so no composite index needs to be deployed. Sorting is done in code.
// Locally, set FIRESTORE_EMULATOR_HOST (for example 127.0.0.1:8085) and the client talks to the
// emulator. On Cloud Run the service account's identity is used; no key file is needed.
// scope(ws) stores a workspace's collections under ws/<id>/<collection>. Visitor workspaces carry an
// expireAt timestamp so a Firestore TTL policy on each collection group deletes them after a day.
const crypto = require('crypto');
const { Firestore } = require('@google-cloud/firestore');

const COLLECTIONS = ['users', 'projects', 'periods', 'photos', 'submissions', 'decisions', 'transmittals', 'monitoring', 'meta', 'aicache', 'notecache'];

function createFirestoreStore({ projectId, databaseId, prefix = '', ttlHours = 24 }) {
  const db = new Firestore({ projectId, databaseId, ignoreUndefinedProperties: true });
  // expireAt is fixed when the visitor copy is created (passed in as expiresAt), not moved by later writes.
  function make(colRef, { expiring, expiresAt }) {
    const fixed = expiresAt ? new Date(expiresAt) : new Date(Date.now() + ttlHours * 3600 * 1000);
    const stamp = (doc) => (expiring ? { ...doc, expireAt: fixed } : doc);
    const strip = (d) => {
      const { expireAt, ...rest } = d; // eslint-disable-line no-unused-vars
      return rest;
    };
    return {
      kind: 'firestore',
      db,
      async get(name, id) {
        const s = await colRef(name).doc(id).get();
        return s.exists ? { ...strip(s.data()), id: s.id } : null;
      },
      async set(name, id, doc) {
        await colRef(name).doc(id).set(stamp({ ...doc, id }));
        return id;
      },
      async update(name, id, patch) {
        await colRef(name).doc(id).set(stamp({ ...patch, id }), { merge: true });
      },
      async add(name, doc) {
        const id = doc.id || crypto.randomUUID();
        await colRef(name).doc(id).set(stamp({ ...doc, id }));
        return id;
      },
      async find(name, where) {
        let q = colRef(name);
        for (const [k, v] of Object.entries(where || {})) q = q.where(k, '==', v);
        const snap = await q.get();
        return snap.docs.map((d) => ({ ...strip(d.data()), id: d.id }));
      },
      async bulkSet(name, docs) {
        for (let i = 0; i < docs.length; i += 400) {
          const batch = db.batch();
          for (const d of docs.slice(i, i + 400)) batch.set(colRef(name).doc(d.id), stamp(d));
          await batch.commit();
        }
      },
      async clear() {
        for (const name of COLLECTIONS) {
          const snap = await colRef(name).get();
          let batch = db.batch();
          let n = 0;
          for (const d of snap.docs) {
            batch.delete(d.ref);
            if (++n % 400 === 0) {
              await batch.commit();
              batch = db.batch();
            }
          }
          await batch.commit();
        }
      },
      async close() {
        await db.terminate();
      }
    };
  }
  const root = make((name) => db.collection(prefix + name), { expiring: false });
  // Read-modify-write of one shared document in a Firestore transaction, so separate instances (for
  // example two revisions during a rollout) cannot overwrite each other. fn(current or null) -> { doc, result }.
  root.transact = (name, id, fn) =>
    db.runTransaction(async (t) => {
      const ref = db.collection(prefix + name).doc(id);
      const snap = await t.get(ref);
      const out = await fn(snap.exists ? { ...snap.data(), id } : null);
      if (out && out.doc) t.set(ref, { ...out.doc, id });
      return out ? out.result : undefined;
    });
  root.scope = (ws, opts = {}) => make((name) => db.collection(`${prefix}ws`).doc(ws).collection(name), { expiring: !['template', 'main'].includes(ws), expiresAt: opts.expiresAt });
  return root;
}

module.exports = { createFirestoreStore, COLLECTIONS };
