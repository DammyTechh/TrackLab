import QRCode from 'qrcode';

/**
 * The token is 12 characters from a 32-letter alphabet with the ambiguous
 * ones removed (no I, L, O, U, 0, 1), because a damaged label gets typed in
 * by hand. That is about 2^60 of space, so labels cannot be enumerated.
 *
 * It is generated ONCE at registration and is immutable in the database
 * (see the equipment_qr_token_immutable trigger). The printed label is
 * therefore permanent: every later update is read through this same code.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

export function generateQrToken(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET.charAt(b % ALPHABET.length)).join('');
}

/**
 * The address printed into every QR code. Labels are printed once and stuck
 * on machines, so this must be the institution's permanent public address,
 * never the computer that happens to be printing.
 *
 * Where it comes from, first match wins:
 *   1. admin      the address the admin saved (Admin -> Public address),
 *                 stored in the database, so every device agrees (0012)
 *   2. build      VITE_PUBLIC_BASE_URL, baked in when the app was built
 *   3. browser    the address this page is open on
 */
export type AddressSource = 'admin' | 'build' | 'browser';

export interface PublicAddress {
  url: string;
  source: AddressSource;
  /** Only works on one computer or one network: labels would not scan elsewhere. */
  isPrivate: boolean;
}

const PRIVATE_ADDRESS = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

export function isPrivateAddress(url: string): boolean {
  return PRIVATE_ADDRESS.test(url);
}

const clean = (value: string | null | undefined) => (value ?? '').trim().replace(/\/+$/, '');

export function resolvePublicAddress(
  fromAdmin: string | null | undefined,
  fromBuild: string | undefined,
  current: string,
): PublicAddress {
  const admin = clean(fromAdmin);
  const build = clean(fromBuild);
  const [url, source]: [string, AddressSource] = admin
    ? [admin, 'admin']
    : build
      ? [build, 'build']
      : [clean(current), 'browser'];
  return { url, source, isPrivate: isPrivateAddress(url) };
}

/**
 * What the admin types, turned into what the database accepts: https, a bare
 * address with no path, lower case. Mirrors the check in 0012, so the person
 * gets a plain-language reason rather than a database error.
 */
export function normalisePublicAddress(input: string): { ok: true; url: string } | { ok: false; error: string } {
  let text = input.trim().toLowerCase();
  if (!text) return { ok: false, error: 'Enter the address people will reach the app on.' };
  if (!/^[a-z]+:\/\//.test(text)) text = `https://${text}`;
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, error: 'That is not a web address. It should look like https://tracklab.yourschool.edu.ng' };
  }
  // The most important reason first: a local address is wrong whatever else is.
  if (isPrivateAddress(`https://${parsed.hostname}`) || !parsed.hostname.includes('.')) {
    return { ok: false, error: 'That address only works on one computer or network. Use the live address everyone can reach.' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, error: 'Use https://. Phone cameras and browsers warn about plain http.' };
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    return { ok: false, error: 'Use just the address, with nothing after it (no /login or other path).' };
  }
  if (parsed.port) return { ok: false, error: 'Leave out the port number.' };
  return { ok: true, url: `https://${parsed.hostname}` };
}

export function passportUrl(base: string, qrToken: string): string {
  return `${base}/e/${qrToken}`;
}

export function labBoardUrl(base: string, publicToken: string): string {
  return `${base}/l/${publicToken}`;
}

/**
 * Error correction M so a scratch or a torn corner still scans, and a quiet
 * zone of 4 modules. Pure black on pure white inside the code — the yellow
 * frame that tells a visitor where to point the camera is drawn outside it.
 */
export async function renderQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
    // The one legitimate exception to the no-colour-literals rule: a QR
    // code is read by a camera, not a person. Pure black on pure white is a
    // scanning requirement, and the brand green would cut the contrast ratio
    // below what a cheap phone camera needs in a lit lab.
    // eslint-disable-next-line no-restricted-syntax
    color: { dark: '#000000', light: '#ffffff' },
  });
}
