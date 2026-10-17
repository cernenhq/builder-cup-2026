// Estimated model spend, kept in a daily ledger document in the shared store and checked BEFORE every
// live call. This is a guard on our own estimate, not a spending limit on the cloud account: set a budget
// alert in the Google Cloud console too.
//
// How the cap holds:
// - Before a live call, its maximum estimated cost is computed from the actual request (prompt length,
//   number of photos, the output limit, which includes thinking tokens) at the selected model's rates
//   (see src/ai/gemini.js). Requests over the size limits are refused before anything is reserved.
// - The reservation is a transaction on the shared daily document: read the recorded spend and the open
//   reservations, refuse if this one would cross the cap, otherwise add it. Separate instances (for
//   example two revisions during a rollout) therefore cannot overwrite each other or both pass the cap.
// - When the call ends, a second transaction replaces the reservation with the cost estimated from the
//   returned token counts; a call that fails or times out keeps its full reservation. A reservation left
//   open by a crash stays counted.
// The prices are our own estimate (Flash 3.8 is not yet on Google's price page).
//
// USD per 1M tokens (input, output incl. thinking). Unknown models use a Pro-class rate.
const PRICES_PER_M = { 'gemini-3.1-pro': [2.0, 12.0], 'gemini-3.8-flash': [1.5, 7.5], 'gemini-3.7-flash': [1.5, 7.5], 'gemini-3.6-flash': [1.5, 7.5] };

function ratesFor(model) {
  return Object.entries(PRICES_PER_M).find(([k]) => String(model).startsWith(k))?.[1] || [2.0, 12.0];
}

function estimateUsd(model, usage) {
  if (!usage) return 0;
  const [pin, pout] = ratesFor(model);
  const i = usage.promptTokenCount || 0;
  const o = (usage.candidatesTokenCount || 0) + (usage.thoughtsTokenCount || 0);
  return (i / 1e6) * pin + (o / 1e6) * pout;
}

// The most a request can cost: input tokens (estimated high) plus the whole output limit.
function maxUsd(model, inputTokens, maxOutputTokens) {
  const [pin, pout] = ratesFor(model);
  return (inputTokens / 1e6) * pin + (maxOutputTokens / 1e6) * pout;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

// rootStore: the shared store (not workspace-scoped), with transact(). capUsd per day; dayFn: YYYY-MM-DD.
function createSpendGuard({ rootStore, capUsd, dayFn }) {
  const docId = (day) => `day_${day}`;
  const blank = () => ({ usd: 0, reserved: 0, calls: 0 });
  return {
    capUsd,
    // Recorded spend plus open reservations for today.
    async today() {
      const d = (await rootStore.get('spend', docId(dayFn()))) || blank();
      return round6((d.usd || 0) + (d.reserved || 0));
    },
    async state() {
      const d = (await rootStore.get('spend', docId(dayFn()))) || blank();
      return { day: dayFn(), spent: d.usd || 0, reserved: d.reserved || 0, calls: d.calls || 0, capUsd };
    },
    // Reserve `amount` for one live call. Returns a ticket, or null when it would cross today's cap or
    // the ledger could not be written (then no paid call is made).
    async reserve(kind, amount) {
      if (!(amount > 0)) return null;
      const day = dayFn();
      try {
        return await rootStore.transact('spend', docId(day), (cur) => {
          const d = cur || blank();
          if ((d.usd || 0) + (d.reserved || 0) + amount > capUsd) return { result: null };
          return { doc: { ...d, reserved: round6((d.reserved || 0) + amount), updatedAt: new Date().toISOString() }, result: { kind, amount, day } };
        });
      } catch (e) {
        return null;
      }
    },
    // Replace a reservation with the estimated actual cost (or keep the full reservation when unknown).
    async settle(ticket, actualUsd) {
      if (!ticket) return;
      const cost = typeof actualUsd === 'number' && actualUsd > 0 ? actualUsd : ticket.amount;
      await rootStore.transact('spend', docId(ticket.day), (cur) => {
        const d = cur || blank();
        return { doc: { ...d, reserved: round6(Math.max(0, (d.reserved || 0) - ticket.amount)), usd: round6((d.usd || 0) + cost), calls: (d.calls || 0) + 1, updatedAt: new Date().toISOString() } };
      });
    }
  };
}

module.exports = { estimateUsd, maxUsd, ratesFor, createSpendGuard, PRICES_PER_M };
