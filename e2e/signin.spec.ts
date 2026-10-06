import { expect, test } from '@playwright/test';
import { mockSupabase } from './supabaseMock';

/**
 * The sign-in page, on a phone and a desktop (see playwright.config.ts).
 * Runs in every institution's repository, with or without an illustration.
 */

test.beforeEach(async ({ context }) => {
  await mockSupabase(context);
});

test('the whole form, Sign in button included, is visible without scrolling', async ({ page }) => {
  await page.goto('/login');
  const button = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(button).toBeVisible();
  const box = (await button.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test('nothing on the sign-in page scrolls sideways', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('the illustration is either shown in full or left out, never a broken image', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const images = await page.evaluate(() =>
    [...document.querySelectorAll('img')].map((img) => ({ src: img.currentSrc || img.src, ok: img.complete && img.naturalWidth > 0 })),
  );
  for (const image of images) expect(image.ok, `${image.src} did not load`).toBe(true);
});
