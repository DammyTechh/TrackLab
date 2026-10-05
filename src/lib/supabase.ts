import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/**
 * One client. Sessions persist so a technician stays signed in offline; the
 * token is refreshed opportunistically when a network returns.
 */
export const supabase = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: `evidencetag.${import.meta.env.VITE_INSTITUTION_CODE}.auth`,
    },
    global: { headers: { 'x-client-info': 'evidencetag-pwa' } },
  },
);

/** Short-lived signed URL for a photo or an SOP. Public passports use these too. */
export async function signedUrl(bucket: string, path: string, seconds = 600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) return null;
  return data.signedUrl;
}

/** Private. SOPs, manuals and certificates; visitors may open only listed SOPs (0007, 0009). */
export const DOCUMENTS_BUCKET = 'documents';

/** The equipment-photos bucket is public: visitors read the passport without an account. */
export const EQUIPMENT_PHOTO_BUCKET = 'equipment-photos';

/**
 * A plain public URL, built locally with no network call. Each photo has its
 * own uuid path and is never overwritten, so the service worker can cache it
 * forever and a technician offline still sees the last photo.
 */
export function equipmentPhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from(EQUIPMENT_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}
