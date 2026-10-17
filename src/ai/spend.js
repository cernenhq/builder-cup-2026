// Estimated model spend, kept in a daily ledger and checked BEFORE every live call. This is a guard on
// our own estimate, not a spending limit on the account: set a budget alert in the Google Cloud console too.
//
// How the cap holds:
// - Each live call first reserves its maximum estimated cost. Calls are bounded (src/ai/gemini.js: at most
//   4 photos, 20 claimed lines and a fixed output limit that includes thinking tokens), and the reservation
//   is the most such a call can cost at the prices below.
// - The check and the reservation happen together with no await in between, so simultaneous requests
//   cannot all pass the check. The service runs as one instance (deploy.sh: max-instances 1).
// - The reservation is written to the shared store BEFORE the call. If that write fails, the call is
//   refused. After a restart, reservations still open in the store are counted as spent.
// - When the call ends the reservation becomes the cost estimated from the token counts; a call that fails
//   or times out keeps its full reservation, because it may still be charged.
// The prices are our own estimate (Flash 3.8 is not yet on Google's price page), so this is a guard on our
// estimate, not a limit on the cloud account.
//
// USD per 1M tokens (input, output incl. thinking). Flash 3.8 price not confirmed on Google's page:
// priced conservatively at the Flash standard rate. Unknown models use a Pro-class rate.
const PRICES_PER_M = { 'gemini-3.1-pro': [2.0, 12.0], 'gemini-3.8-flash': [1.5, 7.5], 'gemini-3.7-flash': [1.5, 7.5], 'gemini-3.6-flash': [1.5, 7.5] };

// Maximum estimated cost per call at the prices above, from the bounds in src/ai/gemini.js:
// reader: input at most ~15k tokens (4 photos, 20 lines) = 0.0225 + output at most 15,000 tokens = 0.1125.
// note: input at most ~3k tokens = 0.0045 + output at most 2,000 tokens = 0.015.
const RESERVE_USD = { reader: 0.14, note: 0.02 };

function estimateUsd(model, usage) {
  if (!usage) return 0;
  const [pin, pout] = Object.entries(PRICES_PER_M).find(([k]) => String(model).startsWith(k))?.[1] || [2.0, 12.0];
  const i = usage.promptTokenCount || 0;
  const o = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
  return (i / 1e6) * pin + (o / 1e6) * pout;
}

// rootStore: the shared store (not workspace-scoped). capUsd per day; dayFn returns YYYY-MM-DD.
function createSpendGuard({ rootStore, capUsd, dayFn }) {
  let day = null;
  let spent = 0; // recorded spend for `day`
  let reserved = 0; // reservations for calls in flight
  let calls = 0;
  let loading = null;
  let writeQueue = Promise.resolve();

  async function load() {
    const d = dayFn();
    if (day === d) return;
    if (!loading) {
      loading = (async () => {
        const doc = await rootStore.get('spend', `day_${d}`);
        day = d;
        // Reservations left open by a restart count as spent.
        spent = doc ? doc.usd + (doc.reserved || 0) : 0;
        calls = doc ? doc.calls || 0 : 0;
        reserved = 0;
      })().finally(() => {
        loading = null;
      });
    }
    await loading;
  }

  // Ordered writes of the whole state; resolves false when the write failed.
  function persist() {
    const snapshot = { id: `day_${day}`, usd: spent, reserved, calls, updatedAt: new Date().toISOString() };
    const w = writeQueue.then(() => rootStore.set('spend', snapshot.id, snapshot)).then(
      () => true,
      () => false
    );
    writeQueue = w;
    return w;
  }

  return {
    capUsd,
    async today() {
      await load();
      return spent;
    },
    // Reserve room for one live call. Returns a ticket, or null when the call would cross today's cap.
    async reserve(kind) {
      await load();
      const amount = RESERVE_USD[kind] || 0.12;
      if (spent + reserved + amount > capUsd) return null; // synchronous from here: no interleaving
      reserved += amount;
      const ticket = { kind, amount, day };
      if (!(await persist())) {
        reserved = Math.max(0, reserved - amount);
        return null; // the ledger could not be written: no paid call
      }
      return ticket;
    },
    // Settle a ticket with the estimated actual cost (or null when unknown: the reservation is kept).
    async settle(ticket, actualUsd) {
      if (!ticket) return;
      if (ticket.day !== day) return; // the day rolled over; the new day starts clean
      reserved = Math.max(0, reserved - ticket.amount);
      spent += typeof actualUsd === 'number' && actualUsd > 0 ? actualUsd : ticket.amount;
      calls += 1;
      await persist();
    },
    // For display and tests.
    state() {
      return { day, spent, reserved, calls, capUsd };
    }
  };
}

module.exports = { estimateUsd, createSpendGuard, PRICES_PER_M, RESERVE_USD };
