const path = require('path');
const { test, expect, signIn, shot, H, SEED_PHOTOS, VERDICT_TEXT } = require('./fixtures');
const { USERS } = require('../../src/seed/demo-data');

test.describe('Mayor', () => {
  test('M1: one screen, only escalated items, in plain words', async ({ page }) => {
    await signIn(page, 'mayor', 'mayor');
    await expect(page.getByTestId('gauge')).toHaveAttribute('data-state', 'red');
    const items = page.getByTestId('escalations').locator('.esc');
    await expect(items).toHaveCount(4);
    const text = await page.getByTestId('escalations').innerText();
    expect(text).toContain('DILG SubayBAYAN update for May 2026 was due on 24 May 2026');
    expect(text).toContain('the 70% milestone was planned for 31 March 2026');
    expect(text).toContain('photos do not show what the progress claim says on 3 line items');
    // Office-only (yellow) items are not here.
    for (const officeOnly of ['Behind plan', 'submitted late', 'awaiting review', 'waiting for the reviewer', 'waiting for a person to decide', 'photo check', 'COA monthly report for May 2026']) expect(text).not.toContain(officeOnly);
    // Nothing else on the screen: no project list, no forms.
    await expect(page.locator('input, select, textarea')).toHaveCount(0);
    await shot(page, 'mayor');
  });

  test('M2: an escalated item leaves the mayor screen once the office logs the report', async ({ page, request }) => {
    // Carlo logs the overdue DILG report (late, flagged): it leaves the mayor's screen.
    const login = await request.post('/api/auth/login', { headers: H, data: { userId: 'eng-carlo' } });
    expect(login.status()).toBe(200);
    const t = await request.post('/api/projects/P-002/transmittals', { headers: H, multipart: { reportKind: 'SUBAYBAYAN', periodKey: '2026-05', submittedOn: '2026-06-01', to: 'DILG municipal field office' } });
    expect((await t.json()).transmittal.late).toBe(true);
    await signIn(page, 'mayor', 'mayor');
    await expect(page.getByTestId('escalations').locator('.esc')).toHaveCount(3);
    await expect(page.getByTestId('escalations')).not.toContainText('SubayBAYAN');
  });
});

test.describe('Contractor', () => {
  test('C1: submit the progress claim and photos through the project link; see status, never verdicts', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="contractor-link-P-002"]');
    await expect(page.getByTestId('contractor-project')).toHaveText('Farm-to-market road concreting, 1.2 km (demo)');
    await page.getByTestId('c-period').fill('2026-05');
    await page.fill('[data-c="sb"]', '100');
    await page.fill('[data-c="abc"]', '85');
    await page.fill('[data-c="pccp"]', '45');
    await page.getByTestId('c-photos').setInputFiles(path.join(SEED_PHOTOS, 'p05.jpg'));
    await page.getByTestId('c-send').click();
    await expect(page.getByTestId('c-msg')).toContainText('Received for May 2026: 3 line(s), 1 photo(s)');
    await expect(page.getByTestId('c-history')).toContainText('Waiting for the office to check it');
    await shot(page, 'contractor');
    // The office has internal verdicts for P-003; the P-003 contractor page still shows none.
    await page.goto('/c/demo-P-003-dos-link');
    await expect(page.getByTestId('c-history')).toContainText('The office has looked at it');
    expect(await page.locator('body').innerText()).not.toMatch(VERDICT_TEXT);
    const api = await page.request.get('/api/contractor/demo-P-003-dos-link');
    expect(await api.text()).not.toMatch(/supported|contradicted|not_assessable|verdict|aiDefault|readers/i);
    // No staff API access with a contractor link.
    expect((await page.request.get('/api/projects/P-003/periods/2026-05')).status()).toBe(401);
  });

  test('C2: the submission arrives where the engineer is waiting for it', async ({ page, request }) => {
    const fd = { period: '2026-05', claims: JSON.stringify([{ lineKey: 'pccp', claimedPct: 45 }]) };
    expect((await request.post('/api/contractor/demo-P-002-uno-link/submissions', { headers: H, multipart: fd })).status()).toBe(200);
    await signIn(page, 'eng-carlo', 'engineer');
    await page.fill('#periodOther', '2026-05');
    await page.dispatchEvent('#periodOther', 'change');
    await expect(page.getByTestId('claims-card')).toContainText("From the contractor's submission");
    await expect(page.locator('[data-claim="pccp"]')).toHaveValue('45');
  });
});

test.describe('Auditor (COA, IAS, DILG), read only', () => {
  test('A1: decision log and submission log with timestamps and who decided; cannot write', async ({ page }) => {
    await signIn(page, 'aud-coa', 'auditor');
    const dl = page.getByTestId('decision-log');
    await expect(dl).toContainText('Benita Cruz (demo)');
    await expect(dl).toContainText('Canopy fascia is still bare framework in the April frame.');
    await expect(dl).toContainText('override');
    const sl = page.getByTestId('submission-log');
    await expect(sl).toContainText('COA monthly report');
    await expect(sl).toContainText('Late: flagged, not counted');
    await expect(page.getByTestId('percent-log')).toContainText('Ana Reyes (demo)');
    // No write controls on the page.
    await expect(page.locator('input, textarea, button:not(#signout)')).toHaveCount(0);
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('audit-csv').click()]);
    expect(require('fs').readFileSync(await csv.path(), 'utf8')).toContain('line decision');
    await shot(page, 'auditor');
    // Writes are refused by the API, not only hidden.
    expect((await page.request.post('/api/projects/P-003/periods/2026-05/decisions', { headers: H, data: { lineKey: 'cb', decision: 'supported', reason: 'audit' } })).status()).toBe(403);
    expect((await page.request.put('/api/projects/P-001/periods/2026-05/percent', { headers: H, data: { value: 10 } })).status()).toBe(403);
    expect((await page.request.post('/api/projects/P-001/monitoring', { headers: H, data: { date: '2026-05-01', kind: 'Site visit' } })).status()).toBe(403);
  });
});

test.describe('Public', () => {
  test('P1: plain progress note; no verdict labels, no staff names, no accusation', async ({ page }) => {
    await page.goto('/public');
    await page.click('text=Multi-purpose building (demo)');
    const note = page.getByTestId('public-note');
    await expect(note).toContainText('What the photos show');
    await expect(note).toContainText('Not visible in the photos, or not yet confirmed');
    await expect(note).toContainText('Roof waterproofing');
    await expect(note).toContainText('68% complete');
    const text = await page.locator('body').innerText();
    expect(text).not.toMatch(VERDICT_TEXT);
    for (const u of USERS) expect(text).not.toContain(u.name.replace(' (demo)', ''));
    await shot(page, 'public');
    // Public has no access to anything internal.
    expect((await page.request.get('/api/projects')).status()).toBe(401);
    expect((await page.request.get('/api/audit/projects/P-001/log')).status()).toBe(401);
  });

  test('P2: sign-in page shows the brand with the trademark sign', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('brand')).toHaveText('Cernen™');
    await expect(page).toHaveTitle('Proof of Progress: Sign in');
    await shot(page, 'login');
  });
});
