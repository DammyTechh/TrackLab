import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Container } from '@/ui/Container';
import { Icon } from '@/ui/Icon';
import { StatusBadge } from '@/ui/StatusBadge';
import { EquipmentRow } from '@/ui/EquipmentRow';
import { equipmentPhotoUrl } from '@/lib/supabase';
import { formatDate } from '@/lib/dates';
import { STATUS, STATUSES, statusClasses, type EquipmentStatus } from '@/lib/status';
import { useAuth } from '@/app/AuthProvider';
import { useMyEquipment } from '@/features/equipment';
import { DashboardCharts } from './DashboardCharts';

/**
 * Read-only. The tiles filter the table beneath them. A senior leader sees
 * every lab; an HOD sees only theirs, because RLS returns only theirs.
 */
export function DashboardPage() {
  const { profile } = useAuth();
  const { data, isLoading } = useMyEquipment();
  const [filter, setFilter] = useState<EquipmentStatus | 'all'>('all');
  const [labFilter, setLabFilter] = useState('all');

  const items = useMemo(() => data?.items ?? [], [data]);
  const labs = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items) if (item.lab) map.set(item.lab_id, item.lab.name);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items]);

  const inLab = items.filter((item) => labFilter === 'all' || item.lab_id === labFilter);
  const counts = new Map<EquipmentStatus, number>();
  for (const item of inLab) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  const visible = inLab
    .filter((item) => filter === 'all' || item.status === filter)
    .sort((a, b) => STATUS[b.status].rank - STATUS[a.status].rank || a.name.localeCompare(b.name));

  return (
    <Container width="app" className="py-6 sm:py-8">
      <h1 className="m-0 text-[28px] font-bold leading-8 tracking-[-0.015em] text-ink-strong">Dashboard</h1>
      <p className="mb-0 mt-2 text-[15px] text-ink-muted">
        {profile?.role === 'lab_hod' ? 'Your labs' : 'Every lab'} · {isLoading ? 'loading…' : `${inLab.length} machines`}
      </p>

      {labs.length > 1 ? (
        <div className="mt-5 max-w-[22rem]">
          <label htmlFor="lab-filter" className="mb-2 block text-[14px] font-semibold text-ink-strong">
            Lab
          </label>
          <select
            id="lab-filter"
            value={labFilter}
            onChange={(e) => setLabFilter(e.target.value)}
            className="min-h-touch w-full rounded-md border border-line-strong bg-surface-raised px-4 text-[15px] text-ink-strong"
          >
            <option value="all">All labs</option>
            {labs.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <DashboardCharts items={inLab} labId={labFilter} />

      <h2 className="mb-0 mt-8 text-[19px] font-semibold text-ink-strong">Equipment</h2>
      <p className="mb-0 mt-1 text-[14px] text-ink-muted">Tap a status to filter the list.</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <Tile active={filter === 'all'} onClick={() => setFilter('all')} label="All" count={inLab.length} icon="inventory_2" />
        {STATUSES.map((status) => (
          <Tile
            key={status}
            active={filter === status}
            onClick={() => setFilter(status)}
            label={STATUS[status].label}
            count={counts.get(status) ?? 0}
            icon={STATUS[status].icon}
            status={status}
          />
        ))}
      </div>

      {/* Phones get rows they can tap; the table needs a wider screen. */}
      <div className="mt-6 overflow-hidden rounded-lg border border-line-subtle md:hidden">
        {visible.length === 0 && !isLoading ? (
          <p className="m-0 bg-surface-raised px-4 py-10 text-center text-ink-muted">No machines in this view.</p>
        ) : (
          visible.map((item, index) => (
            <EquipmentRow
              key={item.id}
              qrToken={item.qr_token}
              name={item.name}
              assetId={item.asset_id}
              location={item.lab?.name ?? item.location}
              nextServiceDue={item.next_service_due}
              status={item.status}
              photoUrl={equipmentPhotoUrl(item.photo_path)}
              last={index === visible.length - 1}
            />
          ))
        )}
      </div>

      <div className="mt-6 hidden overflow-x-auto rounded-lg border border-line-subtle bg-surface-raised md:block">
        <table className="w-full min-w-[44rem] border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-line-subtle text-ink-muted">
              <th className="px-4 py-3 font-semibold">Machine</th>
              <th className="px-4 py-3 font-semibold">Lab</th>
              <th className="px-4 py-3 font-semibold">Next service</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const photo = equipmentPhotoUrl(item.photo_path);
              return (
                <tr key={item.id} className="border-b border-line-subtle last:border-b-0">
                  <td className="px-4 py-3">
                    <Link to={`/e/${item.qr_token}`} className="flex items-center gap-3 no-underline">
                      {photo ? (
                        <img src={photo} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-sm object-cover" />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-ink-muted">
                          <Icon name="science" size={18} />
                        </span>
                      )}
                      <span>
                        <span className="block font-semibold text-ink-strong">{item.name}</span>
                        <span className="mono block text-[13px] text-ink-muted">{item.asset_id}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink">{item.lab?.name ?? '—'}</td>
                  <td className="mono px-4 py-3 text-ink">
                    {item.next_service_due ? formatDate(item.next_service_due) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={item.status} />
                  </td>
                </tr>
              );
            })}
            {!isLoading && visible.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-ink-muted">
                  No machines in this view.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Container>
  );
}

function Tile({
  active,
  onClick,
  label,
  count,
  icon,
  status,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon: string;
  status?: EquipmentStatus;
}) {
  const urgent = status && STATUS[status].signal === 'urgent' && count > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'flex min-h-[88px] flex-col justify-between rounded-lg border p-3 text-left',
        active ? 'border-brand ring-2 ring-brand' : 'border-line-subtle',
        urgent ? statusClasses(status) : 'bg-surface-raised text-ink-strong',
      ].join(' ')}
    >
      <span className="flex items-center gap-1 text-[13px] font-semibold leading-[18px]">
        <Icon name={icon} size={18} />
        {label}
      </span>
      <span className="text-[28px] font-bold leading-8">{count}</span>
    </button>
  );
}
