import { Icon } from './Icon';
import { STATUS, statusClasses, type EquipmentStatus } from '@/lib/status';

/**
 * The one component that answers "can I use this machine?".
 * `sticker` is the single large one on a passport, straddling the plate edge.
 */
export function StatusBadge({
  status,
  sticker = false,
  suffix,
}: {
  status: EquipmentStatus;
  sticker?: boolean;
  /** e.g. "by 12 days" — appended to the label, never replacing it. */
  suffix?: string;
}) {
  const meta = STATUS[status];

  return (
    <span
      className={[
        'inline-flex items-center gap-2 whitespace-nowrap font-semibold',
        statusClasses(status),
        sticker
          ? 'rounded-md px-5 py-3 text-[17px] leading-[22px] shadow-sticker'
          : 'rounded-full py-[5px] pl-2 pr-3 text-[14px] leading-[18px]',
      ].join(' ')}
    >
      <Icon name={meta.icon} filled={meta.solid} size={sticker ? 28 : 18} />
      {meta.label}
      {suffix ? ` ${suffix}` : ''}
    </span>
  );
}
