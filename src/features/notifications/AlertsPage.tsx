import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Container } from '@/ui/Container';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { formatDate } from '@/lib/dates';
import { PushSettings } from './PushSettings';
import { AlertSettings } from './AlertSettings';

interface AlertRow {
  id: string;
  tier: 'upcoming' | 'warning' | 'critical_due' | 'critical_replacement' | 'critical_fault';
  title: string;
  body: string;
  read_at: string | null;
  closed_at: string | null;
  created_at: string;
  equipment: { qr_token: string; asset_id: string } | null;
}

const TIER: Record<AlertRow['tier'], { icon: string; tone: string }> = {
  upcoming: { icon: 'schedule', tone: 'bg-calm-tint text-calm-ink' },
  warning: { icon: 'warning', tone: 'bg-attention-tint text-attention-ink' },
  critical_due: { icon: 'event_busy', tone: 'bg-urgent-tint text-urgent-ink' },
  critical_replacement: { icon: 'swap_horiz', tone: 'bg-urgent-tint text-urgent-ink' },
  critical_fault: { icon: 'error', tone: 'bg-urgent-tint text-urgent-ink' },
};

/** The in-app alert list. The one channel that still works on a LAN with no internet. */
export function AlertsPage() {
  const queryClient = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select(
          'id, tier, title, body, read_at, closed_at, created_at, equipment:equipment(qr_token, asset_id)',
        )
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as unknown as AlertRow[];
    },
  });

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      // The header badge too; it used to wait for the next navigation.
      void queryClient.invalidateQueries({ queryKey: ['alerts-unread'] });
    },
  });

  const unread = data.filter((a) => !a.read_at);

  return (
    <Container width="reading" className="py-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-bold leading-8 tracking-[-0.015em] text-ink-strong">Alerts</h1>
          <p className="mb-0 mt-2 text-[15px] text-ink-muted">
            {isLoading ? 'Loading…' : unread.length ? `${unread.length} unread` : 'Nothing unread.'}
          </p>
        </div>
        {unread.length > 0 ? (
          <Button intent="secondary" icon="done_all" onClick={() => markRead.mutate(unread.map((a) => a.id))}>
            Mark all read
          </Button>
        ) : null}
      </div>

      {!isLoading && data.length === 0 ? (
        <div className="mt-8 rounded-lg border border-line-subtle bg-surface-raised px-6 py-12 text-center">
          <Icon name="notifications_off" size={40} className="text-ink-muted" />
          <p className="mb-0 mt-3 text-[15px] text-ink-muted">
            No alerts. You will see due dates, faults and replacement recommendations for your labs here.
          </p>
        </div>
      ) : (
        <ul className="m-0 mt-6 flex list-none flex-col gap-3 p-0">
          {data.map((alert) => {
            const tier = TIER[alert.tier];
            return (
              <li
                key={alert.id}
                className={`rounded-lg border bg-surface-raised p-4 ${alert.read_at ? 'border-line-subtle' : 'border-line-strong'}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${tier.tone}`}
                  >
                    <Icon name={tier.icon} size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={`m-0 text-[15px] leading-[21px] text-ink-strong ${alert.read_at ? '' : 'font-semibold'}`}
                    >
                      {alert.title}
                    </p>
                    <p className="mb-0 mt-1 text-[14px] leading-5 text-ink">{alert.body}</p>
                    <p className="mono mb-0 mt-2 text-[13px] text-ink-muted">
                      {formatDate(alert.created_at)}
                      {alert.closed_at ? ' · resolved' : ''}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {alert.equipment ? (
                        <Link
                          to={`/e/${alert.equipment.qr_token}`}
                          className="inline-flex items-center gap-1 text-[14px] font-semibold text-brand"
                        >
                          Open {alert.equipment.asset_id}
                          <Icon name="chevron_right" size={18} />
                        </Link>
                      ) : null}
                      {!alert.read_at ? (
                        <button
                          type="button"
                          onClick={() => markRead.mutate([alert.id])}
                          className="text-[14px] font-semibold text-ink-muted underline"
                        >
                          Mark read
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <AlertSettings />
      <PushSettings />
    </Container>
  );
}
