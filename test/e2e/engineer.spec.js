const { test, expect, signIn, geotaggedFrame, shot, H } = require('./fixtures');
const path = require('path');
const { SEED_PHOTOS } = require('./fixtures');

test.describe('Engineer / person in charge', () => {
  test('E1-E3: upload milestone photos (EXIF kept), use the contractor\'s claim, run the check, see per-line verdicts', async ({ page }) => {
    await signIn(page, 'eng-ana', 'engineer');
    await expect(page.getByTestId('brand')).toHaveText('Cernen™');
    await expect(page.getByTestId('period-select')).toHaveValue('2026-05');
    // The contractor's progress claim for May is already in, prefilled.
    await expect(page.getByTestId('claims-card')).toContainText("From the contractor's submission");
    await expect(page.locator('[data-claim="ho"]')).toHaveValue('100');

    await page.getByTestId('photo-input').setInputFiles(await geotaggedFrame('11'));
    await page.fill('#stampText', '05-21-2026 Thu 11:12:21');
    await page.getByTestId('upload-btn').click();
    const thumb = page.getByTestId('photo-thumb').first();
    await expect(thumb).toContainText('2026-05-21 11:12');
    await expect(thumb).toContainText('GPS: 13.01000, 126.51000');

    await page.getByTestId('run-check').click();
    const lines = page.getByTestId('line-results').locator('.line');
    await expect(lines).toHaveCount(3);
    await expect(page.getByTestId('demo-badge')).toHaveText('Demo, not a model result');
    // Hidden work is always can't tell.
    await expect(page.locator('.line[data-line="fo"] [data-verdict]').first()).toHaveText("Can't tell");
    await expect(page.locator('.line[data-line="ho"]')).toContainText('Awaiting a decision');
    // Rule checks ran before the readers.
    await expect(page.getByTestId('check-card')).toContainText('Photo checks (no AI)');
    await expect(page.locator('[data-check="reuse"]').first()).toHaveAttribute('data-level', 'ok');
    await shot(page, 'engineer');
  });

  test('E2b: type the claim when the contractor sent nothing; the office gets monitoring credit for it', async ({ page }) => {
    await signIn(page, 'eng-carlo', 'engineer');
    await page.click('[data-pid="P-002"]');
    await page.fill('#periodOther', '2026-05');
    await page.dispatchEvent('#periodOther', 'change');
    await expect(page.getByTestId('claims-card')).toContainText('Nothing received from the contractor yet');
    await page.fill('[data-claim="pccp"]', '45');
    await page.fill('[data-claim="abc"]', '90');
    await page.getByTestId('save-claims').click();
    await expect(page.getByTestId('claims-card')).toContainText('Typed by the office');
    await expect(page.getByTestId('monitoring')).toContainText('Progress claim entered for the contractor');
  });

  test('E4: enter percent complete once; all four report drafts show it and download', async ({ page }) => {
    await signIn(page, 'eng-ana', 'engineer');
    await page.getByTestId('pct-input').fill('70');
    await page.getByTestId('save-pct').click();
    for (const k of ['COA', 'SUBAYBAYAN', 'IAS', 'MPDO']) {
      await expect(page.getByTestId(`draft-${k}`).getByTestId('draft-pct')).toHaveText('70%');
    }
    await expect(page.getByTestId('draft-MPDO').getByTestId('narrative')).toContainText('is 70% complete');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('draft-SUBAYBAYAN').getByRole('link', { name: 'CSV' }).click()]);
    const csv = require('fs').readFileSync(await dl.path(), 'utf8');
    expect(csv).toContain('Physical accomplishment,70%');
    expect(csv).toContain('DRAFT, not sent');
    await expect(page.getByTestId('latest-pct')).toHaveText('70%');
  });

  test('E5: log when a report was actually submitted, with a transmittal photo; late ones are flagged', async ({ page }) => {
    await signIn(page, 'eng-ana', 'engineer');
    await page.getByTestId('tr-kind').selectOption('COA');
    await page.getByTestId('tr-date').fill('2026-06-01');
    await page.getByTestId('tr-to').fill('COA resident auditor (demo)');
    await page.setInputFiles('#trPhoto', path.join(SEED_PHOTOS, 'p10.jpg'));
    await page.getByTestId('tr-save').click();
    await expect(page.locator('#trMsg')).toContainText('Logged as on time');
    await expect(page.getByTestId('transmittals').locator('tr').nth(1)).toContainText('COA resident auditor (demo) · photo');
    // A late one: the Q1 IAS report was due 10 April 2026.
    await page.getByTestId('tr-kind').selectOption('IAS');
    await page.fill('#trPeriod', '2026-Q1');
    await page.getByTestId('tr-date').fill('2026-04-20');
    await page.getByTestId('tr-save').click();
    await expect(page.locator('#trMsg')).toContainText('flagged as late and not counted as on time');
  });

  test('E6: log monitoring work for credit', async ({ page }) => {
    await signIn(page, 'eng-ana', 'engineer');
    await page.getByTestId('mon-kind').selectOption('Site visit');
    await page.getByTestId('mon-note').fill('Checked the rooftop walls from the street.');
    await page.getByTestId('mon-save').click();
    await expect(page.getByTestId('monitoring')).toContainText('Checked the rooftop walls from the street.');
  });

  test('E8: the engineer overrules the AI default on one line with one click; the line shows the override and the log keeps both', async ({ page }) => {
    await signIn(page, 'eng-ana', 'engineer');
    await page.getByTestId('period-select').selectOption('2026-04');
    // A line with an AI default to overrule (not one where the readers disagree).
    const line = page.getByTestId('line-results').locator('.line').filter({ has: page.locator('button.agree') }).first();
    await expect(line).toBeVisible();
    const key = await line.getAttribute('data-line');
    const aiDefault = await line.locator('[data-verdict]').first().getAttribute('data-verdict');
    const target = aiDefault === 'contradicted' ? 'supported' : 'contradicted';
    await line.locator('[data-pick="The photo shows otherwise"]').click();
    await line.getByTestId(`reason-${key}`).fill('The photo shows otherwise: open bays on the left.');
    await line.getByTestId(`decide-${key}-${target}`).click();
    const fresh = page.locator(`.line[data-line="${key}"]`);
    await expect(fresh.getByTestId('override')).toContainText('Overrides the AI default');
    await expect(fresh.getByTestId('decision')).toHaveAttribute('data-decision', target);
    await expect(fresh.getByTestId('decision')).toContainText('open bays on the left');
    await expect(fresh.getByTestId('decision')).toContainText('Ana Reyes (demo), engineer in charge');
    await expect(fresh.getByTestId('decision')).toContainText('The decision log keeps the AI default and this decision');
    // Agree is one click too, with a default reason when none is typed.
    const second = page.getByTestId('line-results').locator('.line').filter({ has: page.locator('button.agree') }).nth(1);
    const key2 = await second.getAttribute('data-line');
    const agree = second.getByTestId(`agree-${key2}`);
    if (await agree.count()) {
      await agree.click();
      await expect(page.locator(`.line[data-line="${key2}"]`).getByTestId('decision')).toHaveAttribute('data-overrode', '0');
    }
  });

  test('E9: send last month\'s photo, flipped, as a test photo; the rule checks catch it before any AI', async ({ page }) => {
    await signIn(page, 'eng-ana', 'engineer');
    await expect(page.getByTestId('period-select')).toHaveValue('2026-05');
    await expect(page.getByTestId('flip-sample')).toContainText('Test photo');
    await page.getByTestId('flip-btn').click();
    await expect(page.getByTestId('photo-thumb').first()).toContainText('TEST-flipped-copy-of-2026-04.jpg');
    await expect(page.locator('#upMsg')).toContainText('Test photo sent');
    await page.getByTestId('run-check').click();
    const reuse = page.locator('[data-check="reuse"]').first();
    await expect(reuse).toHaveAttribute('data-level', 'flag');
    await expect(reuse).toContainText('this project, 2026-04, mirrored');
    await expect(page.locator('[data-check="stamp_vs_file"]').first()).toHaveAttribute('data-level', 'flag');
    await expect(page.getByTestId('check-card')).toContainText('not proof');
  });

  test('E10b: the saved AI finished look is a Lens and Swipe reference with no model call; Change map is off for it', async ({ page }) => {
    const calls = [];
    page.on('request', (r) => { if (/\/api\/(proto\/gemini|insight|check)/.test(r.url()) && r.method() === 'POST') calls.push(r.url()); });
    await signIn(page, 'eng-ana', 'engineer');
    await page.getByTestId('period-select').selectOption('2026-04');
    const pick = page.getByTestId('lens-month');
    await expect(pick.locator('option[value="ai-finished"]')).toHaveText('AI finished look (illustration)');
    await pick.selectOption('ai-finished');
    await expect(page.getByTestId('lens-ai')).toContainText('not evidence');
    await page.getByTestId('mode-swipe').click();
    const st = page.locator('#lensStage .stage');
    await st.hover({ position: { x: 150, y: 120 } });
    const sw = page.getByTestId('swipe');
    await expect(sw).toBeVisible();
    expect(await sw.evaluate((el) => el.style.backgroundImage)).toContain('/static/finished-look.jpg');
    const img = await page.request.get('/static/finished-look.jpg');
    expect(img.status()).toBe(200);
    await page.getByTestId('mode-change').click();
    await expect(page.getByTestId('lens-status')).toContainText('Change map is off for the AI illustration');
    await expect(page.getByTestId('change-canvas')).toBeHidden();
    expect(calls).toEqual([]);
  });

  test('E10: comparison lens on April 2026 with a month picker; other months show in the same spot', async ({ page }) => {
    await signIn(page, 'eng-ana', 'engineer');
    await page.getByTestId('period-select').selectOption('2026-04');
    const pick = page.getByTestId('lens-month');
    await expect(pick).toBeVisible();
    expect(await pick.locator('option').count()).toBeGreaterThan(5);
    await pick.selectOption('2026-03');
    await expect(page.getByTestId('lens-status')).toContainText('March 2026');
    const st = page.locator('#lensStage .stage');
    await st.hover({ position: { x: 200, y: 120 } });
    const lens = page.getByTestId('lens');
    await expect(lens).toBeVisible();
    expect(await lens.evaluate((el) => el.style.backgroundImage)).toContain('/api/photos/');
    // The evidence boxes stay on the photo.
    expect(await st.locator('.box').count()).toBeGreaterThan(0);
    // Swipe: the other month covers the photo from the left edge up to the pointer.
    await page.getByTestId('mode-swipe').click();
    await expect(page.getByTestId('lens-status')).toContainText('Drag across the photo');
    await st.hover({ position: { x: 150, y: 120 } });
    const sw = page.getByTestId('swipe');
    await expect(sw).toBeVisible();
    expect(await sw.evaluate((el) => el.style.clipPath)).toMatch(/inset\(0(px)? [0-9.]+% 0(px)? 0(px)?\)/);
    await expect(lens).toBeHidden();
    await page.getByTestId('mode-lens').click();
    await pick.selectOption('');
    await st.hover({ position: { x: 220, y: 140 } });
    await expect(lens).toBeHidden();
    await expect(sw).toBeHidden();
  });

  test('E12: change map on April 2026 against March shows a canvas over the photo and the legend', async ({ page }) => {
    await signIn(page, 'eng-ana', 'engineer');
    await page.getByTestId('period-select').selectOption('2026-04');
    await page.getByTestId('lens-month').selectOption('2026-03');
    await page.getByTestId('mode-change').click();
    const cv = page.getByTestId('change-canvas');
    await expect(cv).toBeVisible();
    await expect(cv).toHaveAttribute('data-changed-share', /^[0-9.]+$/);
    await expect(page.getByTestId('change-legend')).toHaveText('Red marks pixels that changed between the two months, after evening out brightness. Pixel change is not a verdict: lighting, weather and blur all change pixels.');
    await expect(page.getByTestId('change-thr')).toBeVisible();
    const before = Number(await cv.getAttribute('data-changed-share'));
    await page.getByTestId('change-thr').fill('90');
    await expect.poll(async () => Number(await cv.getAttribute('data-changed-share'))).toBeLessThanOrEqual(before);
    await page.getByTestId('mode-lens').click();
    await expect(cv).toBeHidden();
    await expect(page.getByTestId('change-legend')).toBeHidden();
  });

  test('E13: more test photos and the camera button in step 1; photo quality panel in step 3', async ({ page }) => {
    await signIn(page, 'eng-ana', 'engineer');
    await expect(page.getByTestId('period-select')).toHaveValue('2026-05');
    await expect(page.getByTestId('recompress-btn')).toBeVisible();
    await expect(page.getByTestId('crop-btn')).toBeVisible();
    await expect(page.getByTestId('flip-sample')).toContainText('a known limit of the reuse check');
    await expect(page.getByTestId('cam-btn')).toHaveText("Take a site photo with this device's camera");
    await expect(page.getByTestId('cam-box')).toContainText('Gemini Live on video is on the roadmap; this takes a still photo.');
    await page.getByTestId('recompress-btn').click();
    await expect(page.locator('#upMsg')).toContainText('Test photo sent');
    await expect(page.getByTestId('photo-thumb').first()).toContainText('TEST-recompressed-copy-of-2026-04.jpg');
    await expect(page.getByTestId('test-photo').first()).toBeVisible();
    // The recompressed copy is caught by the reuse check; the 10% crop is a stated limit and is not.
    await page.getByTestId('crop-btn').click();
    await expect(page.getByTestId('photos-card')).toContainText('TEST-cropped-10pc-copy-of-2026-04.jpg');
    await page.getByTestId('run-check').click();
    const reuse = page.locator('[data-check="reuse"]');
    await expect(reuse).toHaveCount(2);
    await expect(reuse.nth(0)).toHaveAttribute('data-level', 'flag');
    await expect(reuse.nth(1)).toHaveAttribute('data-level', 'ok');
    await expect(reuse.nth(1)).toContainText('Crops can get past this check');

    await page.getByTestId('period-select').selectOption('2026-04');
    const q = page.getByTestId('photo-quality');
    await expect(q).toBeVisible();
    await expect(q).toContainText('This rates the photo as evidence, not the work.');
    for (const k of ['gps', 'dates', 'view', 'resolution']) {
      await expect(q.locator(`[data-q="${k}"]`).first()).toHaveAttribute('data-level', /^(ok|note|flag)$/);
    }
    // Kept apart from the line verdicts.
    expect(await page.getByTestId('line-results').getByTestId('photo-quality').count()).toBe(0);
  });

  test('E11: Draft with Gemini in step 4 shows an editable draft from the decision log only', async ({ page }) => {
    await signIn(page, 'eng-ana', 'engineer');
    await page.getByTestId('period-select').selectOption('2026-04');
    await expect(page.getByTestId('draft-note')).toContainText('Nothing goes out automatically');
    await page.getByTestId('draft-audience').selectOption('mayor');
    await page.getByTestId('draft-gemini').click();
    // The e2e server has no live AI and no saved draft, so it says so; with a saved or live draft the text appears.
    await expect(page.locator('#dnMsg')).toContainText(/Draft ready|judge access code|Live AI is off/);
    if ((await page.locator('#dnMsg').textContent()).includes('Draft ready')) {
      await expect(page.getByTestId('draft-text')).toHaveAttribute('data-done', '1');
      expect((await page.getByTestId('draft-text').inputValue()).length).toBeGreaterThan(20);
    } else {
      await page.getByTestId('draft-text').fill('April 2026: the office checked each line against the site photo. Hidden work is not visible from the camera.');
    }
    // A person keeps the edited text as the report narrative; nothing is sent.
    const kept = (await page.getByTestId('draft-text').inputValue()).trim().slice(0, 30);
    await page.getByTestId('draft-use').click();
    await expect(page.locator('#dnMsg')).toContainText('Saved as the MPDO narrative');
    await expect(page.getByTestId('draft-MPDO').getByTestId('narrative')).toContainText(kept);
  });

  test('E7: the engineer cannot open other roles\' screens, and cannot decide lines on a project they are not in charge of', async ({ page }) => {
    await signIn(page, 'eng-ana', 'engineer');
    await page.goto('/mayor');
    await expect(page).toHaveURL(/\/engineer$/);
    const r1 = await page.request.get('/api/mayor/escalations');
    expect(r1.status()).toBe(403);
    const r2 = await page.request.post('/api/projects/P-002/periods/2026-05/decisions', { headers: H, data: { lineKey: 'pccp', decision: 'supported', reason: 'trying' } });
    expect(r2.status()).toBe(403);
    // Not in charge of P-002: read only.
    await page.goto('/engineer');
    await page.click('[data-pid="P-002"]');
    await expect(page.getByTestId('save-pct')).toBeDisabled();
  });
});
