import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/**
 * Keep the alert bell and the alert list live.
 *
 * Supabase Realtime streams changes to this person's notification rows
 * (published in 0009; RLS means each person only ever receives their own).
 * A new alert, or one marked read on another device, updates the badge
 * without a reload. On a campus LAN with the on-premise server this keeps
 * working with no internet, which is why in-app alerts are the primary
 * channel and push and email are the extras.
 */
export function useLiveAlerts(profileId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!profileId) return;

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts-unread'] });
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    };

    const channel = supabase
      .channel(`alerts:${profileId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `profile_id=eq.${profileId}` },
        refresh,
      )
      .subscribe((status) => {
        // After a dropped connection, anything that arrived meanwhile was
        // missed; one refetch on reconnect closes the gap.
        if (status === 'SUBSCRIBED') refresh();
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profileId, queryClient]);
}
