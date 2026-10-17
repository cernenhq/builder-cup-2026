// The storage interface contract. Runs on the in-memory adapter always, and on the Firestore
// adapter when FIRESTORE_EMULATOR_HOST is set (scripts/test-all.sh starts the emulator).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore } = require('../../src/store/memory');
const { createFirestoreStore } = require('../../src/store/firestore');

const adapters = [['memory', () => createMemoryStore()]];
if (process.env.FIRESTORE_EMULATOR_HOST) {
  adapters.push(['firestore', () => createFirestoreStore({ projectId: 'demo-proof-of-progress', databaseId: '(default)', prefix: `contract${process.pid}_` })]);
}

for (const [name, make] of adapters) {
  test(`storage contract: ${name}`, async () => {
    const s = make();
    await s.clear();
    await s.set('projects', 'A', { name: 'one', n: 1 });
    await s.set('projects', 'B', { name: 'two', n: 2 });
    assert.deepEqual(await s.get('projects', 'A'), { id: 'A', name: 'one', n: 1 });
    assert.equal(await s.get('projects', 'nope'), null);
    await s.update('projects', 'A', { n: 5 });
    assert.equal((await s.get('projects', 'A')).n, 5);
    assert.equal((await s.get('projects', 'A')).name, 'one');
    const id = await s.add('decisions', { projectId: 'A', period: '2026-05', kind: 'line' });
    await s.add('decisions', { projectId: 'B', period: '2026-05', kind: 'line' });
    assert.ok(id);
    assert.equal((await s.find('decisions', { projectId: 'A' })).length, 1);
    assert.equal((await s.find('decisions', { period: '2026-05', kind: 'line' })).length, 2);
    assert.equal((await s.find('decisions', {})).length, 2);
    // Returned objects are copies.
    const a = await s.get('projects', 'A');
    a.name = 'changed';
    assert.equal((await s.get('projects', 'A')).name, 'one');
    await s.clear();
    assert.equal((await s.find('projects', {})).length, 0);
    await s.close();
  });
}
