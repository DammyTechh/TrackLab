import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { digestEmail, escapeHtml, footer, safeColour, type DigestPayload, type RenderedEmail } from './render.ts';

export type { RenderedEmail } from './render.ts';

/**
 * Email tiers use the SAME three signals as the interface: neutral for
 * upcoming, amber for warning, rust for every critical. A technician who
 * reads the email and then opens the app must see one design twice.
 */
const SIGNAL = {
  upcoming: { band: '#e9ece6', ink: '#2b3831', word: 'Upcoming' },
  warning: { band: '#f6ecd2', ink: '#7d5406', word: 'Service warning' },
  critical_due: { band: '#8f2b16', ink: '#ffffff', word: 'Servicing due' },
  critical_fault: { band: '#8f2b16', ink: '#ffffff', word: 'Critical fault' },
  critical_replacement: { band: '#8f2b16', ink: '#ffffff', word: 'Replacement recommended' },
} as const;

/**
 * Chunked, because spreading a multi-megabyte report into String.fromCharCode
 * overflows the argument stack. Service reports are routinely 1-3 MB scans.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}


function layout(
  template: keyof typeof SIGNAL,
  title: string,
  body: string,
  actionUrl: string,
  reason?: unknown,
  brand?: string,
): string {
  const signal = SIGNAL[template] ?? SIGNAL.upcoming;
  return `<!doctype html><html><body style="margin:0;background:#f3f5f1;font-family:Helvetica,Arial,sans-serif;color:#2b3831">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
    <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border:1px solid #e2e6dd;border-radius:14px;overflow:hidden">
      <tr><td style="background:${signal.band};color:${signal.ink};padding:14px 24px;font-size:14px;font-weight:600">${signal.word}</td></tr>
      <tr><td style="padding:24px">
        <h1 style="margin:0;font-size:22px;line-height:28px;color:#10211a">${escapeHtml(title)}</h1>
        <p style="margin:12px 0 0;font-size:15px;line-height:23px">${escapeHtml(body)}</p>
        <p style="margin:24px 0 0">
          <a href="${actionUrl}" style="display:inline-block;background:${safeColour(brand)};color:#ffffff;text-decoration:none;padding:14px 20px;border-radius:10px;font-size:15px;font-weight:600">Open the equipment record</a>
        </p>
      </td></tr>
      <tr><td style="padding:16px 24px;border-top:1px solid #e2e6dd;font-size:12px;line-height:18px;color:#5a6459">
        ${escapeHtml(footer(reason))}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export async function renderEmail(
  supabase: SupabaseClient,
  template: string,
  payload: Record<string, unknown>,
  brand?: string,
  /** The public address the admin saved (institution.public_base_url). */
  publicBaseUrl?: string | null,
): Promise<RenderedEmail> {
  // Links open the address the admin saved, the same one the QR labels use,
  // so moving to a custom domain moves the emails too. APP_BASE_URL is the
  // fallback for before it is saved.
  const base = (publicBaseUrl || Deno.env.get('APP_BASE_URL') || '').replace(/\/+$/, '');
  if (template === 'weekly_digest') return digestEmail(payload as DigestPayload, base, brand);

  const assetId = String(payload.asset_id ?? '');
  const name = String(payload.equipment_name ?? '');
  const actionUrl = `${base}/staff`;
  const tier = template as keyof typeof SIGNAL;

  const subject =
    tier === 'critical_replacement'
      ? `Replacement recommended: ${name} (${assetId})`
      : tier === 'critical_fault'
        ? `Critical fault: ${name} (${assetId})`
        : tier === 'critical_due'
          ? `Servicing overdue: ${name} (${assetId})`
          : `Service due soon: ${name} (${assetId})`;

  const html = layout(tier, String(payload.title ?? subject), String(payload.body ?? ''), actionUrl, payload.reason, brand);

  // The replacement email carries the engineer's report, so the technician can
  // forward one message straight to procurement.
  let attachments: RenderedEmail['attachments'];
  if (payload.attach_report && payload.report_path) {
    const { data } = await supabase.storage.from('event-files').download(String(payload.report_path));
    if (data) {
      attachments = [
        {
          filename: `${assetId}-service-report.pdf`,
          content: toBase64(new Uint8Array(await data.arrayBuffer())),
        },
      ];
    }
  }

  return { subject, html, attachments };
}
