/**
 * Branding as data. Nothing in src/ branches on which institution this is.
 *
 * Two colour values are written onto the document root at boot; <Brandmark />
 * renders the image when a logo URL is set and the wordmark when it is not.
 * That is the entire difference between the two deployments.
 */

export interface Institution {
  code: string;
  name: string;
  productName: string;
  logoUrl: string | null;
  brandPrimary: string;
  brandAccent: string;
  timezone: string;
  /**
   * Base path of the sign-in illustration; the page loads `<base>-640.webp` on
   * phones and `<base>-1100.webp` on larger screens. null: no illustration.
   */
  signinImage: string | null;
}

function required(key: string): string {
  const value = import.meta.env[key as keyof ImportMetaEnv] as string | undefined;
  if (!value) throw new Error(`Missing ${key}. Check deploy/env/<mode>.env.`);
  return value;
}

export const institution: Institution = {
  code: required('VITE_INSTITUTION_CODE'),
  name: required('VITE_INSTITUTION_NAME'),
  productName: required('VITE_PRODUCT_NAME'),
  logoUrl: (import.meta.env.VITE_BRAND_LOGO_URL as string) || null,
  brandPrimary: required('VITE_BRAND_PRIMARY'),
  brandAccent: required('VITE_BRAND_ACCENT'),
  timezone: (import.meta.env.VITE_TIMEZONE as string) || 'Africa/Lagos',
  // Not set at all: the default artwork in public/brand/. Set but empty: none.
  signinImage:
    import.meta.env.VITE_SIGNIN_IMAGE === undefined
      ? '/brand/signin'
      : (import.meta.env.VITE_SIGNIN_IMAGE as string).trim() || null,
};

/** Call once, before the first paint. */
export function applyBranding(target: HTMLElement = document.documentElement): void {
  target.style.setProperty('--brand', institution.brandPrimary);
  target.style.setProperty('--accent', institution.brandAccent);
  document.title = institution.productName;
}

/** TRACKLAB-CHEM-0042 — the shape is institution code, lab code, sequence. */
export function buildAssetId(labCode: string, sequence: number): string {
  return `${institution.code}-${labCode}-${String(sequence).padStart(4, '0')}`;
}
