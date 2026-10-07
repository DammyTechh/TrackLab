import { defineConfig, loadEnv } from 'vite';
import { isLoopbackUrl } from './src/lib/serverAddress';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const envDir = path.resolve(rootDir, 'deploy/env');

/**
 *   npm run dev / npm run build   -> deploy/env/.env.tracklab
 *
 * Vite resolves `--mode <x>` to `<envDir>/.env.<x>`, so the file is named
 * that way. Nothing in src/ branches on the institution: its name, colours
 * and logo come from that file, and its design from src/styles/theme.css.
 */
const REQUIRED = [
  'VITE_INSTITUTION_CODE',
  'VITE_INSTITUTION_NAME',
  'VITE_PRODUCT_NAME',
  'VITE_BRAND_PRIMARY',
  'VITE_BRAND_ACCENT',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
] as const;

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, envDir, 'VITE_');

  // Fail at build time, not at first paint. A deployment that ships without
  // its institution config renders a blank header and an unusable app, and
  // nobody notices until a technician scans a label.
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(', ')} for mode "${mode}".\n` +
        `Copy deploy/env/.env.${mode}.example to deploy/env/.env.${mode} and fill it in.`,
    );
  }

  // A build is what gets deployed. Pointed at a database that exists only on
  // this computer (the local Supabase, http://127.0.0.1:55321), it works here
  // and nowhere else: other computers, even on the same Wi-Fi, and phones get
  // "could not reach the server". That happened to the live site, so a build
  // like that now stops here. `npm run dev` is not affected. For a deliberate
  // local test build, set ALLOW_LOCAL_SUPABASE=1.
  if (command === 'build' && isLoopbackUrl(env.VITE_SUPABASE_URL) && process.env.ALLOW_LOCAL_SUPABASE !== '1') {
    throw new Error(
      `VITE_SUPABASE_URL is ${env.VITE_SUPABASE_URL}, a database on this computer only.\n` +
        'A site built like this cannot be used from any other phone or computer.\n' +
        'Set VITE_SUPABASE_URL to the live address, https://<project-ref>.supabase.co, in the hosting\n' +
        "settings (Vercel: Settings -> Environment Variables) or in deploy/env/.env." + mode + ', and build again.\n' +
        '(For a local test build only: ALLOW_LOCAL_SUPABASE=1 npm run build.)',
    );
  }

  return {
    envDir,
    plugins: [
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        // Registered in src/main.tsx, which also reloads onto a new version.
        injectRegister: false,
        registerType: 'autoUpdate',
        manifest: {
          name: env.VITE_PRODUCT_NAME ?? 'EvidenceTag',
          short_name: env.VITE_PRODUCT_NAME ?? 'EvidenceTag',
          start_url: '/staff',
          display: 'standalone',
          background_color: '#ffffff',
          theme_color: env.VITE_BRAND_PRIMARY,
          icons: [
            { src: '/brand/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/brand/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
          // Cyrillic and Greek font files are bundled by some typefaces but never
          // needed here; they load on demand if a character ever calls for one.
          globIgnores: ['**/*-cyrillic-*', '**/*-greek-*'],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        },
      }),
    ],
    resolve: { alias: { '@': path.resolve(rootDir, 'src') } },
    // ExcelJS and a few other Node-era libraries expect a `global`.
    define: { global: 'globalThis' },
    build: {
      sourcemap: true,
      target: 'es2020',
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            query: ['@tanstack/react-query', '@tanstack/react-query-persist-client'],
            charts: ['recharts'],
            forms: ['zod'],
          },
        },
      },
    },
    server: { port: 5173 },
  };
});
