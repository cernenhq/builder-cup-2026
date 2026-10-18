// Portfolio analytics from BigQuery for the auditor screen (optional, BQ_DATASET set).
// Counts only: no names or reasons. Returns { enabled: false } when off or when the query fails.
module.exports = function registerAnalyticsRoutes(app, deps) {
  const { allow, wrap, analytics } = deps;
  app.get('/api/audit/analytics', allow('auditor', 'reviewer'), wrap(async (req, res) => {
    if (!analytics || !analytics.enabled) return res.json({ enabled: false });
    const s = await analytics.summary();
    if (!s) return res.json({ enabled: false });
    res.json({ enabled: true, source: 'BigQuery', window: 'last 7 days, all demo visitors', ...s });
  }));
};
