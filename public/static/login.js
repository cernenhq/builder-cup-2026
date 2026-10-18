(async function () {
  const { esc, api, header } = window.PoP;
  const { meta } = await header({ subtitle: 'Engineering office, owner and lender' });
  const main = document.getElementById('main');
  // Whoever releases the money comes first, then the LGU official, then the office that does the work.
  const LABEL = {
    funder: 'Owner or lender (funder)',
    mayor: 'LGU official (Mayor)',
    engineer: 'Engineer in charge',
    reviewer: 'Office head (reviewer)',
    auditor: 'Auditor (COA, IAS, DILG)'
  };
  const DESC = {
    funder: 'Read only: where each project stands against plan, what the office confirmed from site photos, and the plan drawn over the camera view.',
    mayor: 'Only the items that have been escalated, in plain words.',
    engineer: 'Upload milestone photos and the progress claim, run the check, decide each line, enter percent complete once, log submissions and monitoring work.',
    reviewer: 'Overrule any line with a reason. Monday view of what is slipping and what is due.',
    auditor: 'Read-only decision log and submission log, with who decided and when.'
  };
  let users = [];
  try {
    users = await api('/api/auth/demo-users');
  } catch (e) {
    main.innerHTML = '<div class="card section"><h2>Sign in</h2><p>Demo sign-in is turned off on this deployment.</p></div>';
    return;
  }
  const groups = ['funder', 'mayor', 'engineer', 'reviewer', 'auditor'];
  main.innerHTML = `<section class="section card" data-testid="start-here"><h2>New here?</h2><p class="small">A guided tour walks through the demo in about three minutes, using the real screens.</p><p><button type="button" class="btn primary" data-tour-start data-testid="tour-start">Take the tour</button> <a class="btn" href="${esc(PoP.base)}/evidence">Evidence: measured, not claimed</a> <a class="btn" href="${esc(PoP.base)}/hood">Under the hood</a> <a class="btn" href="${esc(PoP.base)}/prototype" data-testid="prototype-link">Interactive prototype (recorded results)</a></p></section>
    <section class="section"><h1>Sign in for the demo</h1>
    <p class="small">Pick a person. This demo sign-in stands in for real sign-in (Google sign-in or Identity Platform); the server still checks the role on every request.</p></section>
    ${groups
      .map(
        (g) => `<section class="section"><h2 data-testid="role-group-${esc(g)}">${esc(LABEL[g])}</h2><p class="small">${esc(DESC[g])}</p><div class="roles">${users
          .filter((u) => u.role === g)
          .map((u) => `<button data-user="${esc(u.id)}"><b>${esc(u.name)}</b><span>${esc(u.title)}${u.agency ? `, ${esc(u.agency)}` : ''}</span></button>`)
          .join('')}</div></section>`
      )
      .join('')}
    <section class="section grid cols-2">
      <div class="card"><h2>Contractor</h2><p class="small">Contractors do not sign in. Each project has its own link, which the office sends them. The demo links:</p>
        <ul>${meta.demoContractorLinks.map((l) => `<li><a href="${esc(l.link)}" data-testid="contractor-link-${esc(l.projectId)}">${esc(l.name)}</a></li>`).join('')}</ul></div>
      <div class="card"><h2>Public</h2><p class="small">Anyone can read a plain progress note per project.</p><a class="btn" href="${esc(PoP.base)}/public">Open the public page</a></div>
    </section>
    ${meta.access && meta.access.liveAi ? `<section class="section card" data-testid="judge-access">
      <h2>Judges and organisers</h2>
      ${meta.access.judge
        ? '<p class="small" data-testid="judge-on">Judge access is on in this browser: live Gemini runs and drafts are available (within a daily limit).</p>'
        : `<p class="small">You can open every screen without a code. The supplied demo months open on saved Gemini runs, and the seeded April decisions have saved drafts. Anything new (new photos, changed claims or decisions) needs a live run: enter the access code from the submission form.</p>
           <form id="judgeForm" class="row"><label>Access code <input id="judgeCode" type="password" autocomplete="off" data-testid="judge-code"></label><button class="btn" type="submit">Turn on live AI</button><span id="judgeMsg" class="small"></span></form>`}
    </section>` : ''}`;
  const jf = document.getElementById('judgeForm');
  if (jf)
    jf.onsubmit = async (e) => {
      e.preventDefault();
      const msg = document.getElementById('judgeMsg');
      try {
        await api('/api/access', { method: 'POST', body: { code: document.getElementById('judgeCode').value } });
        location.reload();
      } catch (err) {
        msg.textContent = err.message;
      }
    };
  main.querySelectorAll('[data-user]').forEach((b) => {
    b.onclick = async () => {
      const r = await api('/api/auth/login', { method: 'POST', body: { userId: b.dataset.user } });
      location.href = r.home;
    };
  });
})();
