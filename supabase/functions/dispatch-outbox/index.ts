// dispatch-outbox — drains email_outbox and push_outbox.
//
// Called by pg_cron every five minutes, and directly after a critical event.
// It is the ONLY thing that talks to Resend or to a push endpoint, so the
// whole app keeps working when neither is reachable: the rows simply wait.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';
import { renderEmail } from '../_shared/templates.ts';
import { requireService } from '../_shared/requireService.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const APP_BASE_URL = Deno.env.get('APP_BASE_URL')!;

const MAX_ATTEMPTS = 6;
const BATCH = 50;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Exponential backoff, capped: 1, 2, 4, 8, 16, 32 minutes. */
const backoffMinutes = (attempts: number) => Math.min(2 ** attempts, 32);

async function sendEmails(from: string, brand?: string, publicBaseUrl?: string | null) {
  const { data: rows } = await supabase
    .from('email_outbox')
    .select('*')
    .eq('status', 'pending')
    .lte('send_after', new Date().toISOString())
    .lt('attempts', MAX_ATTEMPTS)
    .limit(BATCH);

  let sent = 0;

  for (const row of rows ?? []) {
    try {
      const { subject, html, attachments } = await renderEmail(supabase, row.template, row.payload, brand, publicBaseUrl);

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from, to: [row.recipient], subject, html, attachments }),
      });

      if (!response.ok) throw new Error(`Resend ${response.status}: ${await response.text()}`);

      await supabase
        .from('email_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', row.id);
      sent += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      await supabase
        .from('email_outbox')
        .update({
          attempts,
          last_error: String(error),
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          send_after: new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString(),
        })
        .eq('id', row.id);
    }
  }
  return sent;
}

async function sendPush() {
  webpush.setVapidDetails(APP_BASE_URL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const { data: rows } = await supabase
    .from('push_outbox')
    .select('*')
    .eq('status', 'pending')
    .lte('send_after', new Date().toISOString())
    .lt('attempts', MAX_ATTEMPTS)
    .limit(BATCH);

  let sent = 0;

  for (const row of rows ?? []) {
    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('*')
      .eq('profile_id', row.profile_id);

    let delivered = false;

    for (const sub of subscriptions ?? []) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(row.payload),
        );
        delivered = true;
      } catch (error) {
        // 404 and 410 mean the browser threw the subscription away. Drop it
        // rather than retrying forever against a dead endpoint.
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        }
      }
    }

    if (delivered || (subscriptions ?? []).length === 0) {
      await supabase
        .from('push_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', row.id);
      sent += 1;
    } else {
      const attempts = row.attempts + 1;
      await supabase
        .from('push_outbox')
        .update({
          attempts,
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          send_after: new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString(),
        })
        .eq('id', row.id);
    }
  }
  return sent;
}

Deno.serve(async (request) => {
  // Only pg_cron (with the service key from Vault) and operators may drain
  // the outbox. Anyone else could trigger a burst of email sends.
  const forbidden = requireService(request);
  if (forbidden) return forbidden;

  const { data: inst } = await supabase.from('institution').select('email_from, product_name, brand_primary, public_base_url').single();
  const from = `${inst?.product_name ?? 'EvidenceTag'} <${inst?.email_from}>`;

  const [emails, pushes] = await Promise.all([sendEmails(from, inst?.brand_primary ?? undefined, inst?.public_base_url), sendPush()]);

  return new Response(JSON.stringify({ emails, pushes }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
