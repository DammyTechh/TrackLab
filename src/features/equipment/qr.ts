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
 * The address printed into every QR code. Labels are printed once and never
 * change, so this must be the institution's permanent public address, not
 * whatever machine happens to be printing. Set VITE_PUBLIC_BASE_URL in the
 * env file; without it the current address is used, which is only right
 * when printing from the live site.
 */
export function publicBaseUrl(): string {
  const configured = (import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined)?.replace(/\/+$/, '');
  return configured || window.location.origin;
}

/** True when labels printed now would point at a laptop instead of the live site. */
export function labelsWouldPointAtLocalhost(): boolean {
  return /^https?:\/\/(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.)/.test(publicBaseUrl());
}

export function passportUrl(qrToken: string): string {
  return `${publicBaseUrl()}/e/${qrToken}`;
}

export function labBoardUrl(publicToken: string): string {
  return `${publicBaseUrl()}/l/${publicToken}`;
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
