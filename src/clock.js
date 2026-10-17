// Dates are handled as plain calendar dates (YYYY-MM-DD) in Philippine time, so a report
// submitted at 23:30 on the 24th counts as the 24th.
const TZ_OFFSET_MIN = 8 * 60; // Asia/Manila, no daylight saving

function manilaDate(d = new Date()) {
  const t = new Date(d.getTime() + TZ_OFFSET_MIN * 60000);
  return t.toISOString().slice(0, 10);
}

function makeClock(fixedToday) {
  return {
    fixed: !!fixedToday,
    today() {
      return fixedToday || manilaDate(new Date());
    },
    // Timestamps for logs are always real time, so the audit trail shows when things happened.
    nowIso() {
      return new Date().toISOString();
    }
  };
}

module.exports = { makeClock, manilaDate };
