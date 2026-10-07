import { expect, test, type Page } from '@playwright/test';
import { MACHINE, TECHNICIAN } from './fixtures';
import { mockSupabase } from './supabaseMock';

/** The problems reported from the live site, each reproduced and checked. */

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(TECHNICIAN.email);
  await page.getByLabel('Password').fill(TECHNICIAN.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('a label this system does not know says so, instead of "cannot be reached"', async ({ page, context }) => {
  await mockSupabase(context);
  await page.goto('/e/NOTAREALCODE');
  await expect(page.getByRole('heading', { name: 'That label does not match any equipment' })).toBeVisible();
  await expect(page.getByText(/can.t load right now/)).toHaveCount(0);
});

test('a scanned label opens for a visitor whose browser holds a broken old sign-in', async ({ page, context }) => {
  await mockSupabase(context);
  // A session left over from before a database rebuild: the server refuses it.
  await page.addInitScript(() => {
    const far = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
    localStorage.setItem(
      'evidencetag.E2E.auth',
      JSON.stringify({
        access_token: 'broken-session-token',
        refresh_token: 'broken',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: far,
        user: { id: '00000000-0000-4000-8000-000000000000', aud: 'authenticated', role: 'authenticated' },
      }),
    );
  });
  await page.goto(`/e/${MACHINE.qr_token}`);
  await expect(page.getByRole('heading', { name: MACHINE.name })).toBeVisible();
});

test('when the server does not answer, the page says why and offers to try again', async ({ page, context }) => {
  await mockSupabase(context);
  await context.route('**/rest/v1/rpc/get_public_equipment', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'upstream timed out' }) }),
  );
  await page.goto(`/e/${MACHINE.qr_token}`);
  await expect(page.getByRole('heading', { name: /can.t load right now/ })).toBeVisible();
  await expect(page.getByText('Reason: upstream timed out')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByText(/campus network/)).toHaveCount(0);
});

test('signing in with no connection says so, not "wrong password"', async ({ page, context }) => {
  await mockSupabase(context);
  await context.route('**/auth/v1/token**', (route) => route.abort('internetdisconnected'));
  await signIn(page);
  await expect(page.getByText(/Could not reach the server/)).toBeVisible();
  await expect(page.getByText(/do not match/)).toHaveCount(0);
});

test('a sign-in with no account behind it is told so, instead of bouncing back silently', async ({ page, context }) => {
  await mockSupabase(context, { hasProfile: false });
  await signIn(page);
  await expect(page.getByText(/has no Test Product account behind it/)).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test('the change-password screen has the same layout as sign-in, illustration included', async ({ page, context }) => {
  await mockSupabase(context, { mustChangePassword: true });
  // Whether this institution has a sign-in illustration, and whether it loads.
  const shown = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLImageElement>('img[srcset*="signin"]')].some(
        (img) => img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().height > 0,
      ),
    );
  await page.goto('/login');
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.waitForLoadState('networkidle');
  const onSignIn = await shown();

  await page.getByLabel('Email').fill(TECHNICIAN.email);
  await page.getByLabel('Password').fill(TECHNICIAN.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/change-password$/);
  await page.waitForLoadState('networkidle');
  expect(await shown()).toBe(onSignIn);
});

test('the admin can add a lab', async ({ page, context }) => {
  const mock = await mockSupabase(context, { role: 'admin' });
  await signIn(page);
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Add lab' }).click();
  const form = page.getByRole('form', { name: 'Add lab' });
  await form.getByLabel('Name').fill('Geology Lab');
  await form.getByLabel('Code').fill('geo 1');
  await expect(form.getByLabel('Code')).toHaveValue('GEO1');
  await form.getByLabel('Building').fill('Science Block C');
  await form.getByRole('button', { name: 'Add lab' }).click();
  await expect
    .poll(() => mock.writes.find((w) => w.table === 'labs')?.body)
    .toMatchObject({ name: 'Geology Lab', code: 'GEO1', building: 'Science Block C', room: null });
});
