// Evidence page (public): what the evaluation measured, read from the result files in eval/.
(async function () {
  const { esc, $, api, header, base } = window.PoP;
  await header({ subtitle: 'Measured, not claimed' });
  const main = $('#main');
  const footer = `<p class="small insight-foot" data-testid="insight-foot"><a href="${esc(base)}/hood">Under the hood</a> · <a href="${esc(base)}/evidence">Evidence</a> · <a href="${esc(base)}/">Sign in</a></p>`;
  let e;
  try {
    e = await api('/api/evidence');
  } catch (err) {
    main.innerHTML = `<p class="small">The evidence could not load: ${esc(err.message)}</p>${footer}`;
    return;
  }
  const a = e.agreement;
  const s = e.stress;
  const frac = (n, d) => (typeof n === 'number' && typeof d === 'number' ? `${esc(n)}/${esc(d)}` : 'n/a');
  const agreeTable = a
    ? `<table class="insight-table" data-testid="agreement-table">
        <thead><tr><th>Approach</th><th>Agrees with reference</th><th>Overclaims caught</th></tr></thead>
        <tbody>
          <tr><td>Accept every line as claimed</td><td>${frac(a.acceptEveryLine.agrees, a.referenceLines)}</td><td>${frac(a.acceptEveryLine.overclaimsCaught, a.referenceContradicted)}</td></tr>
          <tr class="on"><td>AI default (two readers; disagreement goes to the person)</td><td>${frac(a.geminiDefault.agrees, a.referenceLines)}</td><td>${frac(a.geminiDefault.overclaimsCaught, a.referenceContradicted)}</td></tr>
          <tr><td>Reader A alone</td><td>${frac(a.readerA.agrees, a.referenceLines)}</td><td></td></tr>
          <tr><td>Reader B alone</td><td>${frac(a.readerB.agrees, a.referenceLines)}</td><td></td></tr>
        </tbody></table>
        <p class="small">${a.geminiDefault.noAnswer ? `${esc(a.geminiDefault.noAnswer)} lines came back as no answer and ${esc(a.geminiDefault.readersDisagreed || 0)} as readers disagreeing; both go to the person. ` : ''}Lines the AI default called supported where the reference did not: ${esc(a.geminiDefault.supportedWhenReferenceNot ?? 'n/a')}. Model: ${esc(a.model || 'n/a')}, run recorded ${esc(a.recordedAt ? new Date(new Date(a.recordedAt).getTime() + 8 * 3600000).toISOString().slice(0, 10) + ' (Manila)' : 'n/a')}.</p>`
    : '<p class="small">The agreement results file is not on this instance.</p>';
  const crops = s && s.cropsCaught ? Object.entries(s.cropsCaught).map(([k, v]) => `${esc(v)} at ${esc(k.replace('pct', ''))}% crop`).join(', ') : 'n/a';
  const stress = s
    ? `<table class="insight-table" data-testid="stress-table">
        <thead><tr><th>Rule check: same photo reused</th><th>Result</th></tr></thead>
        <tbody>
          <tr><td>Edited copies of an earlier photo flagged (${esc((s.editedCopies.edits || []).join(', '))})</td><td>${frac(s.editedCopies.caught, s.editedCopies.of)}</td></tr>
          <tr><td>Photos from different months left unmatched</td><td>${frac(s.differentMonthsNotMatched.count, s.differentMonthsNotMatched.of)}</td></tr>
          <tr><td>Cropped copies flagged (a stated limit)</td><td>${crops}</td></tr>
        </tbody></table>
        <p class="small">Cropping is a known limit of this check: a cropped copy is not caught. Run on ${esc(s.ranAt ? s.ranAt.slice(0, 10) : 'n/a')}.</p>`
    : '<p class="small">The rule-check results file is not on this instance.</p>';
  main.innerHTML = `<section class="section"><h1>Measured, not claimed</h1>
      <p class="small">Numbers on this page are read from the result files when the app starts, not typed in.</p></section>
    <section class="card section"><h2>Agreement with a reference</h2>${agreeTable}
      <p class="insight-caveat" data-testid="caveats">${esc(e.caveats)}</p></section>
    <section class="card section"><h2>Rule check stress test</h2>${stress}</section>
    <section class="card section"><h2>Speed</h2><p data-testid="latency">${esc(e.latency.text)} (18 Oct 2026).</p></section>
    <p class="small"><a href="${esc(e.filesUrl)}" rel="noopener" target="_blank">Evaluation files on GitHub</a></p>
    ${footer}`;
})();
