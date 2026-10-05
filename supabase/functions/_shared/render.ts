/**
 * Pure email rendering: no Deno, no network, no Supabase client. Kept apart
 * from templates.ts so it can be unit-tested from the app's test suite.
 */

/**
 * Equipment names, titles and bodies are typed by staff. Interpolated raw, a
 * name like "Oven <300 C> & dryer" breaks the email's HTML, and a deliberate
 * one could inject markup into a message that looks official.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Why this person is getting this email. Set by queue_alert (0010). */
export function footer(reason: unknown): string {
  return reason === 'leader'
    ? 'You receive this because you chose to get critical alerts for every laboratory. Change this under Alerts in the app.'
    : 'You receive this because you are a technician or HOD for this laboratory. Change what you get under Alerts in the app.';
}

export interface RenderedEmail {
  subject: string;
  html: string;
  attachments?: { filename: string; content: string }[];
}

const STATUS_WORD: Record<string, string> = {
  faulty: 'Faulty',
  replace: 'Replacement recommended',
  overdue: 'Overdue',
};

export interface DigestPayload {
  to_name?: string;
  week?: string;
  scope?: 'all' | 'own';
  counts?: { overdue?: number; faulty?: number; replace?: number };
  total?: number;
  items?: { asset_id: string; name: string; lab: string; status: string; due: string | null }[];
  truncated?: boolean;
}

/**
 * The Monday summary. Pure, so it can be tested without Deno or a network.
 * Uses the same neutral band and type as the alerts: it is a report, not an
 * alarm, even when the numbers are bad.
 */
/**
 * The institution's brand colour, from its database row. It goes into an
 * HTML style attribute, so anything that is not a plain #rrggbb is refused.
 */
export function safeColour(value: unknown, fallback = '#0b4a28'): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function digestEmail(payload: DigestPayload, baseUrl: string, brand?: string): RenderedEmail {
  const button = safeColour(brand);
  const counts = payload.counts ?? {};
  const total = payload.total ?? 0;
  const where = payload.scope === 'all' ? 'across all laboratories' : 'in your laboratories';
  const subject =
    total === 0
      ? `Weekly equipment summary: nothing outstanding (${payload.week ?? ''})`
      : `Weekly equipment summary: ${total} need${total === 1 ? 's' : ''} attention (${payload.week ?? ''})`;

  const tally = [
    ['Faulty', counts.faulty ?? 0],
    ['Replacement recommended', counts.replace ?? 0],
    ['Overdue for service', counts.overdue ?? 0],
  ]
    .map(
      ([label, n]) =>
        `<td style="padding:12px;border:1px solid #e2e6dd;border-radius:10px;text-align:center">
           <div style="font-family:'IBM Plex Mono',Menlo,monospace;font-size:24px;line-height:28px;color:${
             Number(n) > 0 ? '#8f2b16' : '#10211a'
           }">${n}</div>
           <div style="font-size:12px;line-height:16px;color:#5a6459">${label}</div>
         </td>`,
    )
    .join('<td style="width:8px"></td>');

  const rows = (payload.items ?? [])
    .map(
      (item) => `<tr>
        <td style="padding:10px 0;border-top:1px solid #e2e6dd;font-family:'IBM Plex Mono',Menlo,monospace;font-size:13px;color:#5a6459;white-space:nowrap;vertical-align:top">${escapeHtml(item.asset_id)}</td>
        <td style="padding:10px 12px;border-top:1px solid #e2e6dd;font-size:14px;line-height:20px;color:#10211a;vertical-align:top">${escapeHtml(item.name)}<br><span style="color:#5a6459">${escapeHtml(item.lab)}</span></td>
        <td style="padding:10px 0;border-top:1px solid #e2e6dd;font-size:13px;line-height:20px;color:#8f2b16;text-align:right;vertical-align:top">${escapeHtml(STATUS_WORD[item.status] ?? item.status)}${
          item.status === 'overdue' && item.due ? `<br><span style="color:#5a6459">due ${escapeHtml(item.due)}</span>` : ''
        }</td>
      </tr>`,
    )
    .join('');

  const body =
    total === 0
      ? `<p style="margin:16px 0 0;font-size:15px;line-height:23px">Nothing is overdue, faulty or awaiting a replacement decision ${where}.</p>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px">${rows}</table>
         ${
           payload.truncated
             ? `<p style="margin:12px 0 0;font-size:13px;color:#5a6459">Showing the 25 most urgent of ${total}. The dashboard has the full list.</p>`
             : ''
         }`;

  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f1;font-family:Helvetica,Arial,sans-serif;color:#2b3831">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
    <table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #e2e6dd;border-radius:14px;overflow:hidden">
      <tr><td style="background:#e9ece6;color:#2b3831;padding:14px 24px;font-size:14px;font-weight:600">Weekly summary · ${escapeHtml(payload.week)}</td></tr>
      <tr><td style="padding:24px">
        <h1 style="margin:0;font-size:22px;line-height:28px;color:#10211a">Equipment needing attention ${where}</h1>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px"><tr>${tally}</tr></table>
        ${body}
        <p style="margin:24px 0 0">
          <a href="${escapeHtml(baseUrl)}/dashboard" style="display:inline-block;background:${button};color:#ffffff;text-decoration:none;padding:14px 20px;border-radius:10px;font-size:15px;font-weight:600">Open the dashboard</a>
        </p>
      </td></tr>
      <tr><td style="padding:16px 24px;border-top:1px solid #e2e6dd;font-size:12px;line-height:18px;color:#5a6459">
        You receive this because you turned on the weekly summary. Turn it off under Alerts in the app.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;

  return { subject, html };
}

