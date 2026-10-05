import { Icon } from './Icon';
import type { NetworkState } from '@/offline/network';

const COPY: Record<NetworkState, { icon: string; text: string; className: string }> = {
  online: { icon: 'cloud_done', text: 'Online', className: 'bg-brand-surface text-brand' },
  lan: { icon: 'lan', text: 'Campus network only', className: 'bg-calm-tint text-calm-ink' },
  offline: {
    icon: 'cloud_off',
    text: 'Saved on this phone',
    className: 'bg-attention-tint text-attention-ink',
  },
};

/**
 * Persistent, never a toast. Being offline in a basement lab is normal
 * operation, so this never goes red.
 */
export function SyncState({ state, queued = 0 }: { state: NetworkState; queued?: number }) {
  const { icon, text, className } = COPY[state];

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-[12px] font-semibold leading-4 ${className}`}
    >
      <Icon name={icon} size={18} />
      {text}
      {queued > 0 ? (
        <span className="mono rounded-full bg-surface-plate px-[6px] text-ink-ondark">{queued}</span>
      ) : null}
    </span>
  );
}
