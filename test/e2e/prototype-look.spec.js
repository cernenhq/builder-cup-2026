const { test, expect } = require('./fixtures');

test('P1: the prototype loads the saved finished look as its render reference without a model call', async ({ page }) => {
  const calls = [];
  page.on('request', (r) => { if (r.url().includes('/api/proto/gemini')) calls.push(r.url()); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/prototype');
  await expect.poll(() => page.evaluate(() => typeof RV !== 'undefined' && !!RV.render && RV.render.src)).toContain('/static/finished-look.jpg');
  expect(await page.evaluate(() => RV.renderLabel)).toContain('not evidence');
  expect(errors).toEqual([]);
  expect(calls).toEqual([]);
});
