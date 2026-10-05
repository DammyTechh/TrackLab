import { expect, test, type Page } from '@playwright/test';
import { MACHINE, TECHNICIAN } from './fixtures';
import { mockSupabase, type MockHandle } from './supabaseMock';

/**
 * A technician in the machine's lab: signs in, records what happened, often
 * with no signal at all. The offline path is the one that matters most.
 */

let mock: MockHandle;
test.beforeEach(async ({ context }) => {
  mock = await mockSupabase(context);
});

async function signIn(page: Page, from = `/e/${MACHINE.qr_token}`) {
  await page.goto(from);
  await page.getByRole('button', { name: 'Staff sign in to update' }).click();
  await page.getByLabel('Email').fill(TECHNICIAN.email);
  await page.getByLabel('Password').fill(TECHNICIAN.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // Returned to the passport they started from, now with the update panel.
  await expect(page).toHaveURL(new RegExp(`/e/${MACHINE.qr_token}$`));
  await expect(page.getByRole('button', { name: 'Record an event' })).toBeVisible();
}

test('a wrong password is refused without saying which half was wrong', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TECHNICIAN.email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert').or(page.getByText(/do not match/i)).first()).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('signing in from a passport returns there with the update panel and edit', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('button', { name: 'Edit details' })).toBeVisible();
  await page.getByRole('button', { name: 'Record an event' }).click();
  for (const label of ['Log use', 'Report fault', 'Maintenance', 'Inspection', 'Service report']) {
    await expect(page.getByRole('button', { name: label })).toBeVisible();
  }
});

test('an event recorded with no network is kept on the phone and sent when it returns', async ({ page, context }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Record an event' }).click();
  await page.getByRole('button', { name: 'Log use' }).click();
  await expect(page.getByRole('heading', { name: 'Log use' })).toBeVisible();

  // The basement: no signal at all.
  await context.setOffline(true);
  await page.getByLabel('Purpose').fill('PhD sample batch 14');
  await page.getByRole('button', { name: 'Save use log' }).click();

  // Saved on this device, and nothing has reached the server.
  await expect(page.getByText(/saved on this phone|offline/i).first()).toBeVisible();
  expect(mock.writes.filter((w) => w.table === 'events')).toHaveLength(0);

  // Signal comes back: the outbox drains by itself.
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect
    .poll(() => mock.writes.filter((w) => w.table.startsWith('events')).length, { timeout: 20_000 })
    .toBe(1);
  const [sent] = mock.writes.filter((w) => w.table.startsWith('events'));
  expect(sent!.body).toMatchObject({
    equipment_id: MACHINE.id,
    type: 'use',
    recorded_by: TECHNICIAN.id,
    data: expect.objectContaining({ purpose: 'PhD sample batch 14' }),
  });
  // The device-only flag never reaches the database.
  expect(sent!.body).not.toHaveProperty('synced');
});
