import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { resolvePublicAddress, type PublicAddress } from './qr';

/** The address every QR label on this screen will open. See resolvePublicAddress. */
export function usePublicAddress(): PublicAddress & { loading: boolean } {
  const saved = useQuery({
    queryKey: ['institution-address'],
    queryFn: async () => {
      const { data, error } = await supabase.from('institution').select('public_base_url').limit(1).maybeSingle();
      if (error) throw error;
      return ((data as { public_base_url: string | null } | null)?.public_base_url ?? null) as string | null;
    },
    staleTime: 5 * 60_000,
  });

  return {
    ...resolvePublicAddress(saved.data, import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined, window.location.origin),
    loading: saved.isLoading,
  };
}
