import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': path.resolve(rootDir, 'src') } },
  // Tests get their own institution config, so they never depend on a
  // developer's gitignored .env file or on a real Supabase project.
  define: {
    'import.meta.env.VITE_INSTITUTION_CODE': JSON.stringify('TEST'),
    'import.meta.env.VITE_INSTITUTION_NAME': JSON.stringify('Test University'),
    'import.meta.env.VITE_PRODUCT_NAME': JSON.stringify('EvidenceTag'),
    'import.meta.env.VITE_BRAND_PRIMARY': JSON.stringify('#0b4a28'),
    'import.meta.env.VITE_BRAND_ACCENT': JSON.stringify('#e8b93f'),
    'import.meta.env.VITE_BRAND_LOGO_URL': JSON.stringify(''),
    'import.meta.env.VITE_TIMEZONE': JSON.stringify('Africa/Lagos'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://localhost:54321'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-anon-key'),
    'import.meta.env.VITE_HEALTH_URL': JSON.stringify(''),
  },
  // 30 s: the first ExcelJS import alone can take 6 s on a slower Windows machine.
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts?(x)'], testTimeout: 30_000 },
});
