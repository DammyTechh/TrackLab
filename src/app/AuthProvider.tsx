import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { forgetThisDevice } from '@/features/notifications';

export type AppRole = 'technician' | 'lab_hod' | 'senior_leader' | 'admin';

export interface Profile {
  id: string;
  full_name: string;
  role: AppRole;
  is_active: boolean;
  must_change_password: boolean;
  lab_ids: string[];
}

interface AuthContextValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile(next: Session | null) {
      if (!next) {
        if (!cancelled) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role, is_active, must_change_password, lab_members(lab_id)')
        .eq('id', next.user.id)
        .single();

      if (cancelled) return;

      // The relational select returns a shape the generated types cannot
      // express; name it here rather than scattering casts at every use.
      const row = data as unknown as
        (Omit<Profile, 'lab_ids'> & { lab_members: { lab_id: string }[] | null }) | null;

      setProfile(row ? { ...row, lab_ids: (row.lab_members ?? []).map((m) => m.lab_id) } : null);
      setLoading(false);
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      void loadProfile(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void loadProfile(next);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    // Before the session ends, while removing the row is still authorised.
    await forgetThisDevice();
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, profile, loading, signOut }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
