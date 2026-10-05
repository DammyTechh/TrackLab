import { Icon } from './Icon';

export type AlertTier = 'upcoming' | 'warning' | 'critical_due' | 'critical_replacement' | 'critical_fault';

const TIER: Record<AlertTier, { className: string; icon: string; filled: boolean }> = {
  upcoming: { className: 'bg-surface-raised border-line-strong text-ink', icon: 'schedule', filled: false },
  warning: {
    className: 'bg-attention-tint border-attention-ink text-attention-ink',
    icon: 'schedule',
    filled: true,
  },
  critical_due: {
    className: 'bg-urgent-ink border-urgent-ink text-ink-ondark',
    icon: 'event_busy',
    filled: true,
  },
  critical_fault: {
    className: 'bg-urgent-ink border-urgent-ink text-ink-ondark',
    icon: 'error',
    filled: true,
  },
  critical_replacement: {
    className: 'bg-urgent-ink border-urgent-ink text-ink-ondark',
    icon: 'swap_horiz',
    filled: true,
  },
};

/**
 * Looks the same here, in the email and in the push notification. A
 * technician who reads the email and then opens the app must see one design
 * twice, not two.
 *
 * There is no dismiss. An alert ends when the work is recorded.
 */
export function AlertBanner({ tier, title, body }: { tier: AlertTier; title: string; body: string }) {
  const meta = TIER[tier];
  return (
    <div className={`flex items-start gap-3 rounded-lg border p-4 ${meta.className}`}>
      <Icon name={meta.icon} filled={meta.filled} size={28} />
      <div className="flex-1">
        <p className="m-0 text-[16px] font-semibold leading-[22px]">{title}</p>
        <p className="mb-0 mt-px text-[15px] leading-[23px]">{body}</p>
      </div>
    </div>
  );
}
