// In-memory adapter. Same interface as the Firestore adapter (see store/index.js).
// Documents are deep-copied in and out so callers cannot mutate stored state by accident.
// scope(ws) returns the same interface over that workspace's own collections.
const crypto = require('crypto');

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function createMemoryStore() {
  const cols = new Map();
  const matches = (doc, where) => Object.entries(where || {}).every(([k, v]) => doc[k] === v);
  function make(prefix) {
    const col = (name) => {
      const k = prefix + name;
      if (!cols.has(k)) cols.set(k, new Map());
      return cols.get(k);
    };
    return {
      kind: 'memory',
      async get(name, id) {
        const d = col(name).get(id);
        return d ? clone(d) : null;
      },
      async set(name, id, doc) {
        col(name).set(id, clone({ ...doc, id }));
        return id;
      },
      async update(name, id, patch) {
        const cur = col(name).get(id);
        if (!cur) throw new Error(`Not found: ${name}/${id}`);
        col(name).set(id, clone({ ...cur, ...patch, id }));
      },
      async add(name, doc) {
        const id = doc.id || crypto.randomUUID();
        col(name).set(id, clone({ ...doc, id }));
        return id;
      },
      async find(name, where) {
        return [...col(name).values()].filter((d) => matches(d, where)).map(clone);
      },
      async bulkSet(name, docs) {
        for (const d of docs) col(name).set(d.id, clone(d));
      },
      async clear() {
        for (const k of [...cols.keys()]) if (k.startsWith(prefix) && (prefix || !k.includes('/'))) cols.delete(k);
      },
      async close() {}
    };
  }
  const root = make('');
  root.scope = (ws) => make(`${ws}/`);
  return root;
}

module.exports = { createMemoryStore };
