const { test, expect } = require('./fixtures');

// Until every page carries the <script> tag for tour.js, load it into the page the test is on.
async function ensureTour(page) {
  await page.waitForFunction(() => !!window.PoP);
  if (await page.evaluate(() => !!window.PoPTour)) return;
  const src = await page.evaluate(() => window.PoP.url('/static/tour.js'));
  await page.addScriptTag({ url: src });
  await page.waitForFunction(() => !!window.PoPTour);
}

test.describe('Guided tour', () => {
  test('T1: start on sign-in, Next to step 2, Go there signs in as the funder and keeps the step', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-user="fund-grace"]')).toBeVisible();
    await ensureTour(page);
    await page.evaluate(() => window.PoPTour.start());

    const card = page.getByTestId('tour-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('tour-step')).toHaveText('Step 1 of 10');
    await expect(page.getByTestId('tour-text')).toContainText('reviewer workbench');
    await expect(page.getByTestId('tour-back')).toBeDisabled();
    await expect(page.getByTestId('tour-go')).toHaveCount(0);

    await page.getByTestId('tour-next').click();
    await expect(page.getByTestId('tour-step')).toHaveText('Step 2 of 10');
    await expect(card).toHaveAttribute('data-on-page', '0');
    await page.getByTestId('tour-go').click();

    await page.waitForURL('**/funder');
    await expect(page.locator('body')).toHaveAttribute('data-page', 'funder');
    await ensureTour(page);
    await expect(page.getByTestId('tour-step')).toHaveText('Step 2 of 10');
    await expect(card).toHaveAttribute('data-on-page', '1');
    await expect(page.getByTestId('tour-text')).toContainText('owner or lender');
    await expect(page.getByTestId('tour-go')).toHaveCount(0);

    // Escape ends the tour and clears the stored step.
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('pop_tour'))).toBeNull();
  });

  test('T2: any [data-tour-start] element starts the tour; End tour closes it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-user="fund-grace"]')).toBeVisible();
    await ensureTour(page);
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = '#';
      a.dataset.tourStart = '';
      a.dataset.testid = 'start-link';
      a.textContent = 'Take the tour';
      document.getElementById('main').prepend(a);
    });
    await page.getByTestId('start-link').click();
    await expect(page.getByTestId('tour-step')).toHaveText('Step 1 of 10');
    await page.getByTestId('tour-end').click();
    await expect(page.getByTestId('tour-card')).toHaveCount(0);
  });
});
