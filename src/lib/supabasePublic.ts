import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

/**
 * A connection for the public pages (a scanned label, a lab door board)
 * that never carries anyone's sign-in.
 *
 * Those pages need no account. With the main client, a browser holding an
 * expired or broken session (after a database rebuild, a deleted account, a
 * long time away) sent that session along, the server refused it, and a
 * visitor saw "can't be reached" for a label that was fine.
 */
export const supabasePublic = createClient<Database>(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `evidencetag.${import.meta.env.VITE_INSTITUTION_CODE}.public`,
    },
  },
);
