import { expect, test, type Page } from '@playwright/test';
import { MACHINE, TECHNICIAN } from './fixtures';
import { mockSupabase } from './supabaseMock';
import { passportUrl, renderQrSvg } from '../src/features/equipment/qr';

/**
 * The bug this guards: QR labels printed from a laptop running the app
 * locally pointed at localhost, so they did not scan anywhere else. The
 * page under test is itself served from a local address (127.0.0.1), which
 * is exactly that situation.
 */

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TECHNICIAN.email);
  await page.getByLabel('Password').fill(TECHNICIAN.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
}

/** The drawing of the first QR code on the page, compared by its path data. */
async function firstQrPath(page: Page) {
  const code = page.locator('svg:has(path)').first();
  await expect(code).toBeAttached();
  return code.locator('path').evaluateAll((paths) => paths.map((p) => p.getAttribute('d')).join('|'));
}

test('labels encode the saved public address, even when printed from a local address', async ({ page, context }) => {
  const live = 'https://app.example.edu.ng';
  await mockSupabase(context, { publicBaseUrl: live });
  await signIn(page);
  await page.goto('/staff/labels');

  await expect(page.getByText(`These codes open ${live}`)).toBeVisible();
  await expect(page.getByRole('button', { name: /print/i }).first()).toBeEnabled();

  // Draw the expected code independently and compare the actual QR pattern.
  const expected = await renderQrSvg(passportUrl(live, MACHINE.qr_token));
  const expectedPaths = [...expected.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]).join('|');
  expect(await firstQrPath(page)).toBe(expectedPaths);
});

test('with no saved address on a local machine, printing is blocked with a reason', async ({ page, context }) => {
  await mockSupabase(context, { publicBaseUrl: null });
  await signIn(page);
  await page.goto('/staff/labels');

  await expect(page.getByRole('alert').filter({ hasText: 'can’t be printed yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: /print/i }).first()).toBeDisabled();
  // Not even on screen: a code on screen is as scannable as a printed one.
  await expect(page.locator('svg:has(path)')).toHaveCount(0);
  await expect(page.getByText('The codes appear here once the public address is set.')).toBeVisible();
});
