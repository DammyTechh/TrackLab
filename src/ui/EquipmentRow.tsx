import { Link } from 'react-router-dom';
import { StatusBadge } from './StatusBadge';
import { Icon } from './Icon';
import { formatDate } from '@/lib/dates';
import type { EquipmentStatus } from '@/lib/status';

/**
 * The whole row is one link. The badge is hard right on every row so a reader
 * scanning a lab board sees a single column of chips and can count the urgent
 * ones without reading a word.
 */
export function EquipmentRow({
  qrToken,
  name,
  assetId,
  location,
  nextServiceDue,
  status,
  icon = 'science',
  photoUrl,
  last = false,
}: {
  qrToken: string;
  name: string;
  assetId: string;
  location: string | null;
  nextServiceDue: string | null;
  status: EquipmentStatus;
  icon?: string;
  /** The machine's photo; the icon shows when there is none. */
  photoUrl?: string | null;
  last?: boolean;
}) {
  return (
    <Link
      to={`/e/${qrToken}`}
      className={`flex min-h-[72px] items-center gap-4 bg-surface-raised px-4 py-3 text-ink no-underline hover:bg-brand-surface ${
        last ? '' : 'border-b border-line-subtle'
      }`}
    >
      {photoUrl ? (
        // Decorative: the name beside it says what the machine is.
        <img
          src={photoUrl}
          alt=""
          loading="lazy"
          className="h-12 w-12 shrink-0 rounded-sm bg-surface-sunken object-cover"
        />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-ink-muted">
          <Icon name={icon} />
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold leading-[22px] text-ink-strong">
          {name}
        </span>
        <span className="mono mt-px flex flex-wrap gap-3 text-[13px] leading-[18px] text-ink-muted">
          <span>{assetId}</span>
          {location ? <span>{location}</span> : null}
          {nextServiceDue ? <span>Due {formatDate(nextServiceDue)}</span> : null}
        </span>
        {/* On a phone the badge goes under the name, so a long one like
            "Replacement recommended" cannot squeeze the name to nothing. */}
        <span className="mt-2 block sm:hidden">
          <StatusBadge status={status} />
        </span>
      </span>

      <span className="hidden shrink-0 sm:block">
        <StatusBadge status={status} />
      </span>
    </Link>
  );
}
