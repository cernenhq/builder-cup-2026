// BigQuery analytics (optional, BQ_DATASET set). Filled in by the analytics work; until then a no-op.
// record(kind, row) never throws and never delays a request.
function createAnalytics(config) { // eslint-disable-line no-unused-vars
  return { enabled: false, record() {}, async summary() { return null; } };
}
module.exports = { createAnalytics };
