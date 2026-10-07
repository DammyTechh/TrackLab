/**
 * An address that means "this same computer": 127.0.0.1, localhost, ::1.
 *
 * The local Supabase that `npx supabase start` runs lives at one
 * (http://127.0.0.1:55321). A website built pointing at it works on the
 * laptop that runs it and on no other device, even one on the same Wi-Fi:
 * on every other device, 127.0.0.1 is that device itself. It happened to
 * the live site, and the only symptom was "could not reach the server".
 */
export function isLoopbackUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0' || /^127\./.test(host);
  } catch {
    return false;
  }
}

/**
 * Why a page cannot reach its database, when the reason is the setup rather
 * than the connection: it was built pointing at a database that exists only
 * on the computer that built it. null when that is not the case.
 */
export function serverAddressProblem(supabaseUrl: string | undefined, pageHost: string | undefined): string | null {
  if (!isLoopbackUrl(supabaseUrl)) return null;
  // On that same computer, a local database is a normal way to work.
  if (pageHost && isLoopbackUrl(`http://${pageHost.includes(':') && !pageHost.startsWith('[') ? `[${pageHost}]` : pageHost}`)) {
    return null;
  }
  return `This website was built to use a database at ${new URL(supabaseUrl!).host}, which only exists on the computer that built it, so no other phone or computer can reach it. In the hosting settings (on Vercel: Settings → Environment Variables), VITE_SUPABASE_URL must be the live Supabase address, https://<project-ref>.supabase.co. Then redeploy.`;
}
