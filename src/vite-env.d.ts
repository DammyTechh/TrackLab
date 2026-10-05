/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Typed so a missing institution value is a compile error, not a blank header. */
interface ImportMetaEnv {
  readonly VITE_INSTITUTION_CODE: string;
  readonly VITE_INSTITUTION_NAME: string;
  readonly VITE_PRODUCT_NAME: string;
  readonly VITE_BRAND_PRIMARY: string;
  readonly VITE_BRAND_ACCENT: string;
  readonly VITE_BRAND_LOGO_URL: string;
  readonly VITE_TIMEZONE: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_HEALTH_URL: string;
  /** Optional. Web Push public key; the push opt-in is hidden without it. */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  readonly VITE_PUBLIC_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
