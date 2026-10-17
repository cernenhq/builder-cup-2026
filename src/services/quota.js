// Photo limit per visitor copy. Slots for the files in a request are reserved in a transaction on a
// counter in the copy (meta/photoQuota) before anything is stored, so separate service instances cannot
// both take the last slots; unused slots are given back afterwards.
function createPhotoQuota({ store, enabled, max }) {
  return {
    max,
    async reserve(n) {
      if (!enabled || !n) return true;
      const base = (await store.find('photos', {})).length; // only used the first time the counter is made
      return store.transact('meta', 'photoQuota', (cur) => {
        const used = cur ? cur.used : base;
        if (used + n > max) return { result: false };
        return { doc: { used: used + n }, result: true };
      });
    },
    async release(n) {
      if (!enabled || !(n > 0)) return;
      await store.transact('meta', 'photoQuota', (cur) => (cur ? { doc: { used: Math.max(0, cur.used - n) } } : {}));
    }
  };
}

module.exports = { createPhotoQuota };
