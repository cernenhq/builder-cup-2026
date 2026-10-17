const { test, expect, signIn, shot, H } = require('./fixtures');

test.describe('Reviewer / municipal engineer (office head)', () => {
  test('R1: Monday view shows lagging projects, reports due or late this week, and who is in charge', async ({ page }) => {
    await signIn(page, 'rev-benita', 'reviewer');
    const lag = page.getByTestId('lagging');
    await expect(lag.locator('tr[data-lagging]').first()).toContainText('Farm-to-market road');
    await expect(lag.locator('tr[data-lagging="yes"]')).toHaveCount(2);
    const rep = page.getByTestId('reports-week');
    await expect(rep).toContainText('DILG SubayBAYAN update, May 2026');
    await expect(rep).toContainText('Overdue');
    await expect(rep).toContainText('COA monthly report, May 2026');
    await expect(rep).toContainText('Due soon');
    await expect(rep).toContainText('Late: flagged, not counted');
    await expect(page.getByTestId('incharge')).toContainText('Carlo Bautista (demo)');
    await expect(page.getByTestId('credit')).toContainText('Ana Reyes (demo)');
    await shot(page, 'reviewer-monday');
  });

  test('R2: confirm or override every line with a reason; the override is logged and shows in history', async ({ page }) => {
    await signIn(page, 'rev-benita', 'reviewer');
    await page.getByRole('button', { name: 'Review lines' }).click();
    await expect(page.getByTestId('queue-select')).toHaveValue('P-003|2026-05');
    const lines = page.getByTestId('review-lines');
    await expect(lines.locator('.line')).toHaveCount(7);
    // Reason is required.
    await page.click('[data-pick="sl|supported"]');
    await page.click('[data-save="sl"]');
    await expect(page.locator('[data-msg="sl"]')).toContainText('Give a reason');
    // Readers disagree on columns and beams: no default; the reviewer decides.
    await expect(page.locator('.line[data-line="cb"]')).toContainText('The readers disagree');
    await page.click('[data-pick="cb|contradicted"]');
    await page.fill('[data-reason="cb"]', 'Only ground-floor columns in the photo, and it matches another project\'s photo.');
    await page.click('[data-save="cb"]');
    await expect(page.locator('.line[data-line="cb"] [data-testid="decided"]')).toContainText('override');
    // Confirm a line where the readers agreed.
    await page.click('[data-pick="sl|supported"]');
    await page.fill('[data-reason="sl"]', 'Slab edge visible.');
    await page.click('[data-save="sl"]');
    await expect(page.locator('.line[data-line="sl"] [data-testid="decided"]')).toContainText('confirmed');
    await shot(page, 'reviewer-review');
    await page.getByRole('button', { name: 'Override history' }).click();
    await expect(page.getByTestId('overrides')).toContainText("Only ground-floor columns in the photo, and it matches another project's photo.");
    // It is in the auditor's log, with name and time.
    const log = await (await page.request.get('/api/audit/projects/P-003/log')).json();
    const d = log.decisions.find((x) => x.lineKey === 'cb');
    expect(d.by.name).toBe('Benita Cruz (demo)');
    expect(d.overrode || d.readersDisagreed).toBeTruthy();
  });

  test('R3: a flagged photo check can be explained; the explanation is logged, the flag is not removed from the record', async ({ page }) => {
    await signIn(page, 'rev-benita', 'reviewer');
    await page.getByRole('button', { name: 'Review lines' }).click();
    await expect(page.locator('[data-check="reuse"]')).toHaveAttribute('data-level', 'flag');
    await page.fill('[data-flag$="|reuse"]', 'Contractor says it was the wrong file; asked for the right one by phone.');
    await page.click('[data-saveflag$="|reuse"]');
    await expect(page.getByTestId('review-lines')).toBeVisible();
    await expect(page.locator('text=Explained by Benita Cruz (demo)')).toBeVisible();
    await expect(page.locator('[data-check="reuse"]')).toHaveAttribute('data-level', 'flag');
  });

  test('R5: Monday view lays the plan over the latest checked photo, with the finish range and the caveat', async ({ page }) => {
    await signIn(page, 'rev-benita', 'reviewer');
    const ov = page.getByTestId('owner-view');
    await expect(ov).toBeVisible();
    await expect(page.getByTestId('owner-overlay').locator('img')).toHaveAttribute('src', /\/api\/photos\//);
    await expect(ov).toContainText('The owner and lender view');
    await expect(ov).toContainText('At the pace reported so far');
    await expect(page.getByTestId('finish-range')).toHaveText(/^Finish [A-Z][a-z]{2} 20\d\d to [A-Z][a-z]{2} 20\d\d$/);
    await expect(page.getByTestId('owner-caveat')).toHaveText(
      'Hand-built demo model, fitted to the May 2026 camera view from six matched points. The schedule is fictional. Hidden work, like fit-out and services, is never shown as done or late: a photo cannot see it.'
    );
    for (const t of ['Built, as the photos show', 'Planned by now, not visible', 'In progress', 'Still to come']) await expect(page.getByTestId('owner-legend')).toContainText(t);
    await expect(page.getByTestId('timeline-mark')).toContainText('May 2026');
    const table = page.getByTestId('trajectory-table');
    await expect(table).toContainText('Schedule performance index (SPI)');
    await expect(table).toContainText('Earned schedule');
    await expect(table).toContainText('Three-point estimate');
    // Either the model is drawn (element counts) or the plain fallback note shows; both are text.
    await expect(page.getByTestId('overlay-counts')).toContainText('Apr 2026');
    // The existing lists still work under it.
    await expect(page.getByTestId('lagging').locator('tr[data-lagging="yes"]')).toHaveCount(2);
    await shot(page, 'reviewer-monday-owner');
  });

  test('R4: the reviewer cannot enter percent complete or see the mayor screen', async ({ page }) => {
    await signIn(page, 'rev-benita', 'reviewer');
    expect((await page.request.put('/api/projects/P-001/periods/2026-05/percent', { headers: H, data: { value: 70 } })).status()).toBe(403);
    expect((await page.request.get('/api/mayor/escalations')).status()).toBe(403);
  });
});
