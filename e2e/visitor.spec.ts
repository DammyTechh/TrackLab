import { expect, test } from '@playwright/test';
import { MACHINE, SOP, SUPABASE_URL } from './fixtures';
import { mockSupabase, type MockHandle } from './supabaseMock';

/**
 * A student or visitor: no account, arrives by pointing a phone camera at a
 * label. Most people who ever use the system only ever do this.
 */

let mock: MockHandle;
test.beforeEach(async ({ context }) => {
  mock = await mockSupabase(context);
});

test('a scanned label opens straight onto the passport, status first', async ({ page }) => {
  await page.goto(`/e/${MACHINE.qr_token}`);

  await expect(page.getByRole('heading', { name: MACHINE.name })).toBeVisible();
  await expect(page.getByText(MACHINE.asset_id).first()).toBeVisible();
  await expect(page.getByText('Overdue', { exact: false }).first()).toBeVisible();
  await expect(page.getByText(SOP.title)).toBeVisible();
});

test('a visitor can read but is offered sign-in, never the update panel', async ({ page }) => {
  await page.goto(`/e/${MACHINE.qr_token}`);
  await expect(page.getByRole('button', { name: 'Staff sign in to update' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record an event' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit details' })).toHaveCount(0);
});

test('an SOP opens in a new tab, signed for exactly that file', async ({ page, context }) => {
  await page.goto(`/e/${MACHINE.qr_token}`);

  // What the app owns: a new tab, pointed at a short-lived signed URL for
  // this one file. Whether the browser then shows the PDF inline or saves it
  // is the browser's business (a headless one saves it).
  const fileRequested = context.waitForEvent(
    'request',
    (r) => r.method() === 'GET' && r.url().includes(`/storage/v1/object/sign/documents/${SOP.file_path}`),
  );
  const [tab] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: SOP.title }).click(),
  ]);
  const request = await fileRequested;

  expect(request.frame().page()).toBe(tab);
  expect(new URL(request.url()).searchParams.get('token')).toBeTruthy();
  expect(mock.signed).toEqual([`documents/${SOP.file_path}`]);
});

test('a damaged or unknown label says so plainly', async ({ page }) => {
  await page.goto('/e/NOTAREALCODE');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: MACHINE.name })).toHaveCount(0);
});

test('the bare address sends a visitor to sign in, not a 404', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('nothing on the passport makes the page scroll sideways', async ({ page }) => {
  await page.goto(`/e/${MACHINE.qr_token}`);
  await expect(page.getByRole('heading', { name: MACHINE.name })).toBeVisible();
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement!;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
});

test('loads nothing from third-party hosts, so it works on a campus LAN with no internet', async ({
  page,
  baseURL,
}) => {
  const allowed = new Set([new URL(baseURL!).host, new URL(SUPABASE_URL).host, 'www.gstatic.com']);
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && !allowed.has(url.host)) foreign.push(request.url());
  });

  await page.goto(`/e/${MACHINE.qr_token}`);
  await expect(page.getByRole('heading', { name: MACHINE.name })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  // www.gstatic.com is only the network probe asking "is the internet up?".
  expect(foreign).toEqual([]);
});

test('icons render as icons, from the self-hosted font', async ({ page }) => {
  await page.goto(`/e/${MACHINE.qr_token}`);
  await expect(page.getByRole('heading', { name: MACHINE.name })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  expect(await page.evaluate(() => document.fonts.check('20px "Material Symbols Rounded"'))).toBe(true);

  // Drawn as an icon, a ligature is about one em wide. If the font failed,
  // the same element shows the word itself, several times wider.
  const icon = page.locator('span', { hasText: /^location_on$/ }).first();
  const { width, height } = (await icon.boundingBox())!;
  expect(width).toBeLessThan(height * 1.6);
});
