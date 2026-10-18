// Records the saved Gemini runs the demo replays, and scores them against the frozen reference labels.
// Runs locally with Application Default Credentials on Vertex AI. Costs money: the daily cap below
// stops live calls once the estimated spend reaches it.
//   GOOGLE_CLOUD_PROJECT=<id> node scripts/record-runs.js
// Writes src/seed/saved-runs.json (replayed by the demo) and eval/R2_<stamp>.{json,md}.
// The readers see each month with NO earlier reviewer corrections, so the score is not helped by
// decisions made on the same lines.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CAP = Number(process.env.RECORD_CAP_USD || 1.8);
// RECORD_NOTES_ONLY=1: re-record the saved drafts after the seeded decisions change; no evaluation report.
const NOTES_ONLY = process.env.RECORD_NOTES_ONLY === '1';
const newNoteIds = new Set();

async function main() {
  if (!process.env.GOOGLE_CLOUD_PROJECT) throw new Error('Set GOOGLE_CLOUD_PROJECT.');
  const photoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pop-record-'));
  const { build } = require('../src/server');
  const built = await build({
    ...process.env,
    NODE_ENV: 'development',
    STORE: 'memory',
    PHOTOS: 'local',
    PHOTO_DIR: photoDir,
    LIVE_AI: '1',
    MOCK_AI: '',
    WORKSPACES: '0',
    SEED: 'reset',
    RECORD_SHARED: '1',
    DAILY_CAP_USD: String(CAP),
    GOOGLE_CLOUD_LOCATION: process.env.GOOGLE_CLOUD_LOCATION || 'global'
  });
  const { store, rootStore, photoStore, readers, config } = built;
  const { runInWs, als, MAIN } = require('../src/workspace');
  const { runCheck, periodId } = require('../src/services/check');
  const A = require('../src/services/actions');
  const D = require('../src/seed/demo-data');
  const { draftNote } = require('../src/services/notes');
  // The same guard and live readers the app uses, so every call reserves room under the cap.
  const { spend, live } = built;

  // Same store, but the readers get no earlier corrections.
  const noCorrections = { ...store, find: (name, where) => (name === 'decisions' ? Promise.resolve([]) : store.find(name, where)) };
  const user = { id: 'eng-ana', name: 'Ana Reyes (demo)', role: 'engineer' };
  const results = [];
  await new Promise((resolve, reject) =>
    als.run({ ws: MAIN, judge: true }, async () => {
      try {
        const p1 = await store.get('projects', 'P-001');
        // Saved drafts for the seeded April decisions, one per audience. Written first, from the seeded
        // state, before any check is re-run (a re-run makes the seeded decisions belong to an earlier run).
        for (const audience of ['office', 'mayor', 'public', 'owner']) {
          try {
            const n = await draftNote({ store, rootStore, live, spend, judge: true, config, project: p1, period: '2026-04', audience });
            newNoteIds.add(n.key);
            console.log(`note ${audience}: ${n.text.slice(0, 80)}...`);
          } catch (e) {
            console.log(`note ${audience} failed: ${e.message}`);
          }
        }
        if (NOTES_ONLY) return resolve();
        for (const m of D.MONTHS) {
          if (m.notSeeded) {
            await A.addPhoto({ store, photoStore, project: p1, period: m.period, buffer: fs.readFileSync(path.join(__dirname, '..', 'seed-photos', m.file)), fileName: m.file, contentType: 'image/jpeg', user, source: 'office', stampText: m.stamp, recorded: { exif: { taken: m.emb, gps: null, make: null, model: null }, metadataSource: 'recorded from the source video clip', sourceResolution: m.res, framingNote: m.framing || '' } });
          }
          const check = await runCheck({ store: noCorrections, photoStore, readers, project: p1, period: m.period, user });
          results.push({ project: 'P-001', period: m.period, k: m.k, check });
          console.log(`P-001 ${m.period}: aiMode=${check.aiMode} lines=${check.lines.length} ms=${check.ms.A}/${check.ms.B} spent=$${(await spend.today()).toFixed(4)}`);
        }
        const p3 = await store.get('projects', 'P-003');
        const c3 = await runCheck({ store: noCorrections, photoStore, readers, project: p3, period: '2026-05', user });
        results.push({ project: 'P-003', period: '2026-05', check: c3 });
        console.log(`P-003 2026-05: aiMode=${c3.aiMode} spent=$${(await spend.today()).toFixed(4)}`);
        resolve();
      } catch (e) {
        reject(e);
      }
    })
  );

  // Score against the frozen reference: lines where the two blind AI labellers agree.
  const MAP = { S: 'supported', C: 'contradicted', N: 'not_assessable' };
  const rows = [];
  for (const r of results.filter((x) => x.project === 'P-001')) {
    for (const c of D.CLAIMS[r.k] || []) {
      const l = r.check.lines.find((x) => x.lineKey === c.l);
      if (!l) continue;
      rows.push({ period: r.period, line: c.l, id: c.id, ref: c.A === c.B ? MAP[c.A] : null, refA: MAP[c.A], refB: MAP[c.B], A: l.readers.A && l.readers.A.verdict, B: l.readers.B && l.readers.B.verdict, aiDefault: l.aiDefault, hidden: l.hidden });
    }
  }
  const agreed = rows.filter((x) => x.ref);
  const cnt = (f) => agreed.filter(f).length;
  const answered = rows.filter((x) => x.A && x.B);
  const metrics = {
    statementLines: rows.length,
    referenceLines: agreed.length,
    referenceContradicted: cnt((x) => x.ref === 'contradicted'),
    acceptEveryLine: { agrees: cnt((x) => x.ref === 'supported'), overclaimsCaught: 0 },
    geminiDefault: {
      agrees: cnt((x) => x.aiDefault === x.ref),
      readersDisagreed: cnt((x) => x.aiDefault === 'disagree'),
      noAnswer: cnt((x) => x.aiDefault === 'no_answer'),
      overclaimsCaught: cnt((x) => x.ref === 'contradicted' && x.aiDefault === 'contradicted'),
      supportedWhenReferenceNot: cnt((x) => x.aiDefault === 'supported' && x.ref !== 'supported')
    },
    readerA: { agrees: cnt((x) => x.A === x.ref) },
    readerB: { agrees: cnt((x) => x.B === x.ref) },
    readersDisagreeAllLines: { disagree: answered.filter((x) => x.A !== x.B).length, of: answered.length }
  };
  const ms = results.flatMap((r) => [r.check.ms.A, r.check.ms.B]).filter(Boolean).sort((a, b) => a - b);
  const msPerLine = results.map((r) => Math.max(r.check.ms.A, r.check.ms.B) / Math.max(1, r.check.lines.length)).sort((a, b) => a - b);
  const timing = { medianCallMs: ms[Math.floor(ms.length / 2)] || null, medianMsPerLine: Math.round(msPerLine[Math.floor(msPerLine.length / 2)] || 0) };
  const spent = await spend.today();

  const aicache = await rootStore.find('aicache', {});
  // Keep only drafts that match the current seeded decisions (older ones can never match again).
  const notecache = (await rootStore.find('notecache', {})).filter((n) => newNoteIds.has(n.id) || !NOTES_ONLY);
  const out = path.join(__dirname, '..', 'src', 'seed', 'saved-runs.json');
  // Keep any saved Cloud Vision results (written by scripts/record-vision.js).
  let visioncache = [];
  try {
    visioncache = JSON.parse(fs.readFileSync(out, 'utf8')).visioncache || [];
  } catch (e) {
    visioncache = [];
  }
  fs.writeFileSync(out, `${JSON.stringify({ recordedAt: new Date().toISOString(), model: config.geminiModel, aicache, notecache, visioncache }, null, 1)}\n`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  if (NOTES_ONLY) {
    console.log(`Notes re-recorded (${notecache.length}); no evaluation report written. Estimated spend: US$${(await spend.today()).toFixed(4)}`);
    fs.rmSync(photoDir, { recursive: true, force: true });
    return;
  }
  fs.mkdirSync(path.join(__dirname, '..', 'eval'), { recursive: true });
  const report = { recordedAt: new Date().toISOString(), model: config.geminiModel, setup: 'v3 Node readers (prompt in src/ai/prompt.js), one photo per month, no earlier corrections', metrics, timing, estimatedSpendUsd: Number(spent.toFixed(4)), rows };
  fs.writeFileSync(path.join(__dirname, '..', 'eval', `R2_${stamp}.json`), `${JSON.stringify(report, null, 1)}\n`);
  const M = metrics;
  const md = `# R2: v3 readers against the frozen reference (${report.recordedAt})

Model: ${config.geminiModel} on Vertex AI. Setup: ${report.setup}.
Reference: the ${M.referenceLines} of ${M.statementLines} statement lines where two AI labellers (Claude and GPT, labelled blind, frozen before any Gemini run) agree. This is a provisional AI reference, not ground truth.

| | Agrees with the reference | Overclaims caught (of ${M.referenceContradicted}) |
|---|---|---|
| Accept every line | ${M.acceptEveryLine.agrees}/${M.referenceLines} | 0/${M.referenceContradicted} |
| v3 AI default (two Gemini readers) | ${M.geminiDefault.agrees}/${M.referenceLines} | ${M.geminiDefault.overclaimsCaught}/${M.referenceContradicted} |
| Reader A alone | ${M.readerA.agrees}/${M.referenceLines} | |
| Reader B alone | ${M.readerB.agrees}/${M.referenceLines} | |

On reference lines the readers disagreed (no default, the person decides) ${M.geminiDefault.readersDisagreed} times; no answer ${M.geminiDefault.noAnswer}. The default said "supported" where the reference did not ${M.geminiDefault.supportedWhenReferenceNot} times.
Across all ${M.readersDisagreeAllLines.of} answered lines the two readers disagreed on ${M.readersDisagreeAllLines.disagree}.
Timing: median model call ${timing.medianCallMs} ms; median time per claimed line ${timing.medianMsPerLine} ms (both readers run in parallel; one call covers all lines in a month).
Estimated spend for this run: US$${spent.toFixed(4)} (cap US$${CAP}).
One run; not a noise estimate. Development data: the prompt was written by the team before this run, but the reference labels and claims were also written by the team.
`;
  fs.writeFileSync(path.join(__dirname, '..', 'eval', `R2_${stamp}.md`), md);
  console.log(md);
  fs.rmSync(photoDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
