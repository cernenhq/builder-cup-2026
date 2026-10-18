// Under the hood (public): how a check runs, the latest model calls on this instance, today's estimate.
(async function () {
  const { esc, $, api, header, base, fmtTime } = window.PoP;
  await header({ subtitle: 'Under the hood' });
  const main = $('#main');
  const footer = `<p class="small insight-foot" data-testid="insight-foot"><a href="${esc(base)}/evidence">Evidence</a> · <a href="${esc(base)}/hood">Under the hood</a> · <a href="${esc(base)}/">Sign in</a></p>`;
  const steps = [
    ['Photo and claim in', 'The office uploads milestone photos and the contractor\'s claimed progress lines.'],
    ['Rule checks', 'Same photo reused, photo dates, camera view, and a Cloud Vision web check for photos already online.'],
    ['Two readers', 'Two Gemini 3.8 Flash readers on Vertex AI read each line against the photos, with structured output.'],
    ['A person decides', 'Supported, contradicted or can\'t tell is the person\'s call; the readers only flag.'],
    ['Firestore log', 'Each decision and its reason is logged.'],
    ['Report drafts', 'Report drafts, a public note in Filipino via Cloud Translation, and counts in BigQuery.']
  ];
  const flow = `<ol class="insight-flow" data-testid="hood-flow">${steps.map(([t, d]) => `<li><b>${esc(t)}</b><span class="small">${esc(d)}</span></li>`).join('')}</ol>`;
  const fails = `<ul class="insight-fails" data-testid="hood-fails">
      <li>A reply that does not fit the format shows as no answer.</li>
      <li>A timeout keeps its spend reservation.</li>
      <li>Vision or Translation errors never block the check.</li>
      <li>No API keys on the deployed service: Vertex AI, Vision and Translation use its service account.</li></ul>`;
  let h = { calls: [], spend: null };
  let loadErr = '';
  try {
    h = await api('/api/hood');
  } catch (err) {
    loadErr = err.message;
  }
  const n = (v) => (v === null || v === undefined ? '' : esc(v));
  const tok = (t) => (t ? [t.prompt, t.output, t.thinking].map((v) => (v === null || v === undefined ? '-' : esc(v))).join(' / ') : '');
  const rows = (h.calls || [])
    .map(
      (c) => `<tr data-testid="hood-call"><td>${esc(fmtTime ? fmtTime(c.at) : c.at)}</td><td>${n(c.kind)}${c.reader ? ` ${esc(c.reader)}` : ''}</td><td>${n(c.model)}</td><td>${n(c.ms)}</td><td>${n(c.lines)}</td><td>${n(c.msPerLine)}</td><td>${tok(c.tokens)}</td><td>${typeof c.usd === 'number' ? `$${esc(c.usd.toFixed(4))}` : ''}</td><td>${c.error ? 'no answer' : 'ok'}</td></tr>`
    )
    .join('');
  const calls = rows
    ? `<div class="insight-scroll"><table class="insight-table"><thead><tr><th>Time</th><th>Kind</th><th>Model</th><th>ms</th><th>Lines</th><th>ms per line</th><th>Tokens in / out / thinking</th><th>Est. USD</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<p class="small">${loadErr ? `The call list could not load: ${esc(loadErr)}` : 'No model calls on this instance since it started. Saved runs do not call the model.'}</p>`;
  const sp = h.spend;
  const spend = sp
    ? `<p data-testid="hood-spend">Today (${esc(sp.day)}): $${esc(Number(sp.spentUsd || 0).toFixed(4))} recorded, $${esc(Number(sp.reservedUsd || 0).toFixed(4))} reserved, ${esc(sp.calls)} calls, daily cap $${esc(sp.capUsd)}.</p><p class="small">${esc(sp.note)}</p>`
    : '<p class="small">No spend ledger on this instance.</p>';
  main.innerHTML = `<section class="section"><h1>Under the hood</h1><p class="small">How one check runs, and what this instance has done today.</p></section>
    <section class="card section"><h2>How a check runs</h2>${flow}</section>
    <section class="card section"><h2>Latest model calls on this instance</h2><p class="small">Up to 20, newest first. No prompt text, no photos, no workspace ids.</p>${calls}</section>
    <section class="card section"><h2>Today's spend ledger</h2>${spend}</section>
    <section class="card section"><h2>What happens when something fails</h2>${fails}</section>
    ${footer}`;
})();
