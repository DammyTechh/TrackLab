import { defineConfig, devices } from '@playwright/test';
import { SUPABASE_URL } from './e2e/fixtures';

const PORT = 4173;

/**
 * End-to-end tests: the real built app, in a real browser, on a phone and a
 * desktop viewport. Supabase is answered by e2e/supabaseMock.ts.
 *
 *   npx playwright install chromium   (once)
 *   npm run test:e2e
 *
 * Where Playwright cannot download its browser, point it at any Chromium:
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium npm run test:e2e
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // A service worker would answer requests before the mock could.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    launchOptions: executablePath
      ? { executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
      : {},
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
  ],
  webServer: {
    // Its own output folder, so a test run never replaces a production dist/.
    command: `npx vite build --mode e2e --outDir dist-e2e && npx vite preview --mode e2e --outDir dist-e2e --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    // Always a fresh build: reusing a server left running from an earlier run
    // tests old code, and once made a check pass that should have failed.
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      VITE_INSTITUTION_CODE: 'E2E',
      VITE_INSTITUTION_NAME: 'End-to-end University',
      VITE_PRODUCT_NAME: 'Test Product',
      VITE_BRAND_PRIMARY: '#0b4a28',
      VITE_BRAND_ACCENT: '#e8b93f',
      VITE_BRAND_LOGO_URL: '',
      VITE_TIMEZONE: 'Africa/Lagos',
      VITE_SUPABASE_URL: SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: 'e2e-anon-key',
      VITE_PUBLIC_BASE_URL: `http://127.0.0.1:${PORT}`,
    },
  },
});
