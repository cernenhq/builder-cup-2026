const { test, expect, signIn } = require('./fixtures');

test('F-OV: the owner page shows the overview from stored decisions: lines, claim split, photo checks, inspector pins, by trade, who uses it', async ({ page }) => {
  const calls = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/(proto|insight|projects\/.*\/check)/.test(r.url())) calls.push(r.url()); });
  await signIn(page, 'fund-grace', 'funder');
  const ov = page.locator('[data-pid="P-001"] [data-testid="funder-overview"]');
  await expect(ov.getByTestId('ov-lines')).toContainText('April 2026');
  await expect(ov.getByTestId('ov-lines').locator('.chip').first()).toBeVisible();
  await expect(ov.getByTestId('ov-split')).toContainText('on contradicted lines');
  await expect(ov.getByTestId('ov-contradicted')).toHaveText(/^₱[0-9.]+M$/);
  expect(await ov.getByTestId('ov-rules').locator('tbody tr').count()).toBe(6);
  await expect(ov.getByTestId('ov-inspect')).toContainText('Where to send an inspector, April 2026');
  expect(await ov.getByTestId('ov-pin').count()).toBeGreaterThan(0);
  await expect(ov.getByTestId('ov-inspect')).toContainText('Hidden work');
  await expect(ov.getByTestId('ov-trade')).toContainText('Not visible from any photo');
  expect(await ov.getByTestId('ov-trade').locator('.ov-cell.c-con').count()).toBeGreaterThan(0);
  await page.locator('[data-role="auditor"]').click();
  await expect(page.getByTestId('ov-who-text')).toContainText('Read only');
  expect(calls).toEqual([]);
});
