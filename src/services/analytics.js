// BigQuery portfolio analytics (optional, on when BQ_DATASET is set).
// record(kind, data) never throws and never delays a request: rows are queued in memory and sent
// with a streaming insert every 2 s or every 50 rows. Rows hold counts and codes only: no names,
// no reasons, no free text. The workspace id is kept only as a short one-way hash (copy_id).
// summary() runs one query over the last 7 days and caches the result for 5 minutes.
const crypto = require('crypto');

const BQ_SCHEMA = [
  { name: 'event_time', type: 'TIMESTAMP', mode: 'NULLABLE' },
  { name: 'kind', type: 'STRING', mode: 'NULLABLE' },
  { name: 'copy_id', type: 'STRING', mode: 'NULLABLE' },
  { name: 'project_id', type: 'STRING', mode: 'NULLABLE' },
  { name: 'period', type: 'STRING', mode: 'NULLABLE' },
  { name: 'line_key', type: 'STRING', mode: 'NULLABLE' },
  { name: 'ai_mode', type: 'STRING', mode: 'NULLABLE' },
  { name: 'model', type: 'STRING', mode: 'NULLABLE' },
  { name: 'ai_default', type: 'STRING', mode: 'NULLABLE' },
  { name: 'reader_a', type: 'STRING', mode: 'NULLABLE' },
  { name: 'reader_b', type: 'STRING', mode: 'NULLABLE' },
  { name: 'decision', type: 'STRING', mode: 'NULLABLE' },
  { name: 'overrode', type: 'BOOL', mode: 'NULLABLE' },
  { name: 'decided_by_role', type: 'STRING', mode: 'NULLABLE' }
];
const COLUMNS = BQ_SCHEMA.map((c) => c.name);

const FLUSH_MS = 2000;
const BATCH = 50;
const MAX_ATTEMPTS = 3; // first try plus at most two retries
const CACHE_MS = 5 * 60 * 1000;
const MAX_QUEUE = 5000; // keep memory bounded if BigQuery is unreachable
const API = 'https://bigquery.googleapis.com/bigquery/v2';

function copyIdOf(ws) {
  return crypto.createHash('sha256').update(String(ws || 'main')).digest('hex').slice(0, 12);
}

function currentCopyId() {
  try {
    const s = require('../workspace').als.getStore();
    return copyIdOf(s && s.ws);
  } catch (e) {
    return copyIdOf(null);
  }
}

const str = (v) => (v === undefined || v === null || v === '' ? null : String(v));

// Only the listed columns are ever sent, so a stray field cannot carry a name or reason.
function clean(row) {
  const out = {};
  for (const c of COLUMNS) out[c] = c === 'overrode' ? (typeof row[c] === 'boolean' ? row[c] : null) : str(row[c]);
  return out;
}

function rowsFor(kind, data, copyId, now) {
  const d = data || {};
  const project = d.project || {};
  if (kind === 'check') {
    const check = d.check || {};
    const models = check.models || {};
    return (check.lines || []).filter(Boolean).map((l) =>
      clean({
        event_time: check.runAt || now,
        kind: 'check_line',
        copy_id: copyId,
        project_id: project.id,
        period: d.period,
        line_key: l.lineKey,
        ai_mode: check.aiMode,
        model: models.A,
        ai_default: l.aiDefault,
        reader_a: l.readers && l.readers.A ? l.readers.A.verdict : null,
        reader_b: l.readers && l.readers.B ? l.readers.B.verdict : null,
        decided_by_role: check.runBy && check.runBy.role
      })
    );
  }
  if (kind === 'decision') {
    const dec = d.decision || {};
    return [
      clean({
        event_time: dec.at || now,
        kind: 'decision',
        copy_id: copyId,
        project_id: project.id || dec.projectId,
        period: dec.period,
        line_key: dec.lineKey,
        ai_mode: dec.aiMode,
        ai_default: dec.aiDefault,
        reader_a: dec.readerA,
        reader_b: dec.readerB,
        decision: dec.decision,
        overrode: typeof dec.overrode === 'boolean' ? dec.overrode : null,
        decided_by_role: dec.by && dec.by.role
      })
    ];
  }
  return [];
}

function warn(message, extra) {
  try {
    console.log(JSON.stringify({ severity: 'WARNING', message, ...extra }));
  } catch (e) {
    /* logging must not throw */
  }
}

function summarySql(project, dataset, table) {
  const t = `\`${project}.${dataset}.${table}\``;
  return `WITH w AS (SELECT * FROM ${t} WHERE event_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY))
SELECT 'decision' AS metric, decision AS k, COUNT(*) AS n FROM w WHERE kind = 'decision' GROUP BY decision
UNION ALL SELECT 'overrode', NULL, COUNTIF(overrode) FROM w WHERE kind = 'decision'
UNION ALL SELECT 'matched_default', NULL, COUNTIF(decision = ai_default) FROM w WHERE kind = 'decision'
UNION ALL SELECT 'decisions', NULL, COUNT(*) FROM w WHERE kind = 'decision'
UNION ALL SELECT 'copies', NULL, COUNT(DISTINCT copy_id) FROM w
UNION ALL SELECT 'check_line', ai_default, COUNT(*) FROM w WHERE kind = 'check_line' GROUP BY ai_default`;
}

// jobs.query response -> plain numbers.
function parseSummary(data) {
  const out = { decisions: 0, decisionsByOutcome: {}, overrides: 0, matchedAiDefault: 0, matchedShare: null, copies: 0, checkLines: 0, checkLinesByAiDefault: {} };
  for (const r of (data && data.rows) || []) {
    const [metric, k, n] = (r.f || []).map((c) => (c ? c.v : null));
    const num = Number(n) || 0;
    const key = k === null || k === undefined ? 'none' : String(k);
    if (metric === 'decision') out.decisionsByOutcome[key] = num;
    else if (metric === 'overrode') out.overrides = num;
    else if (metric === 'matched_default') out.matchedAiDefault = num;
    else if (metric === 'decisions') out.decisions = num;
    else if (metric === 'copies') out.copies = num;
    else if (metric === 'check_line') {
      out.checkLinesByAiDefault[key] = num;
      out.checkLines += num;
    }
  }
  out.matchedShare = out.decisions ? Math.round((out.matchedAiDefault / out.decisions) * 1000) / 1000 : null;
  return out;
}

function disabled() {
  return { enabled: false, record() {}, async summary() { return null; }, async flush() {}, stop() {} };
}

// opts (tests): client (object with request()), now(), flushMs, batch.
function createAnalytics(config, opts = {}) {
  const cfg = config || {};
  if (!cfg.bqDataset) return disabled();
  const project = cfg.gcpProject || '';
  const dataset = cfg.bqDataset;
  const table = cfg.bqTable || 'events';
  const flushMs = opts.flushMs || FLUSH_MS;
  const batch = opts.batch || BATCH;
  const now = opts.now || (() => Date.now());

  let clientP = opts.client ? Promise.resolve(opts.client) : null;
  function getClient() {
    if (!clientP) {
      clientP = Promise.resolve()
        .then(() => {
          const { GoogleAuth } = require('google-auth-library');
          return new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
        })
        .catch((e) => {
          clientP = null;
          throw e;
        });
    }
    return clientP;
  }

  let queue = [];
  let timer = null;
  let sending = Promise.resolve();
  let cache = null;

  async function send(rows) {
    const url = `${API}/projects/${encodeURIComponent(project)}/datasets/${encodeURIComponent(dataset)}/tables/${encodeURIComponent(table)}/insertAll`;
    const body = { rows: rows.map((r) => ({ insertId: crypto.randomUUID(), json: r })) };
    let lastErr = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const client = await getClient();
        const res = await client.request({ url, method: 'POST', data: body });
        const errs = (res && res.data && res.data.insertErrors) || [];
        if (errs.length) warn('bq_insert_row_errors', { rows: rows.length, rowErrors: errs.length });
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    warn('bq_insert_failed', { rows: rows.length, attempts: MAX_ATTEMPTS, error: String((lastErr && lastErr.message) || lastErr).slice(0, 300) });
  }

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!queue.length) return sending;
    const rows = queue;
    queue = [];
    const chunks = [];
    for (let i = 0; i < rows.length; i += 500) chunks.push(rows.slice(i, i + 500));
    sending = sending.then(async () => {
      for (const c of chunks) await send(c).catch(() => {});
    });
    return sending;
  }

  function record(kind, data) {
    try {
      const rows = rowsFor(kind, data, currentCopyId(), new Date(now()).toISOString());
      if (!rows.length) return;
      queue.push(...rows);
      if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
      if (queue.length >= batch) flush();
      else if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          flush();
        }, flushMs);
        if (timer.unref) timer.unref();
      }
    } catch (e) {
      warn('bq_record_failed', { error: String((e && e.message) || e).slice(0, 300) });
    }
  }

  async function summary() {
    if (cache && now() - cache.at < CACHE_MS) return cache.value;
    try {
      const client = await getClient();
      const res = await client.request({
        url: `${API}/projects/${encodeURIComponent(project)}/queries`,
        method: 'POST',
        data: { query: summarySql(project, dataset, table), useLegacySql: false, timeoutMs: 10000 }
      });
      const data = res && res.data;
      if (!data || data.jobComplete === false) throw new Error('query did not finish in time');
      const value = parseSummary(data);
      cache = { at: now(), value };
      return value;
    } catch (e) {
      warn('bq_summary_failed', { error: String((e && e.message) || e).slice(0, 300) });
      return null;
    }
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { enabled: true, record, summary, flush, stop, _queueLength: () => queue.length };
}

module.exports = { createAnalytics, BQ_SCHEMA, parseSummary, rowsFor, copyIdOf, summarySql };
