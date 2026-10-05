import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { UnknownCode } from '@/features/public-passport';
import { useQuery } from '@tanstack/react-query';
import { supabase, equipmentPhotoUrl } from '@/lib/supabase';
import { EquipmentRow } from '@/ui/EquipmentRow';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/Container';
import { STATUS, STATUSES, type EquipmentStatus } from '@/lib/status';

interface LabEquipment {
  qr_token: string;
  asset_id: string;
  name: string;
  location: string | null;
  status: EquipmentStatus;
  next_service_due: string | null;
  photo_path: string | null;
}

/**
 * Scanned once at the door and read by a whole class. A list, not a grid: the
 * badges line up in one column so a reader can count the urgent ones.
 */
export function LabBoardPage() {
  const { labToken = '' } = useParams();
  const [filter, setFilter] = useState<EquipmentStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['lab', labToken],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_public_lab', { p_public_token: labToken });
      if (error) throw error;
      return data as { name: string; equipment: LabEquipment[] };
    },
  });

  const counts = useMemo(() => {
    const result = new Map<EquipmentStatus, number>();
    for (const item of data?.equipment ?? []) result.set(item.status, (result.get(item.status) ?? 0) + 1);
    return result;
  }, [data]);

  const visible = (data?.equipment ?? []).filter((item) => {
    if (filter !== 'all' && item.status !== filter) return false;
    const q = search.trim().toLowerCase();
    return !q || item.name.toLowerCase().includes(q) || item.asset_id.toLowerCase().includes(q);
  });

  if (isLoading)
    return (
      <Container className="py-10">
        <p className="text-ink-muted">Loading this lab…</p>
      </Container>
    );

  if (isError)
    return (
      <Container className="py-16 text-center">
        <Icon name="wifi_off" size={40} className="text-ink-muted" />
        <h1 className="mt-4 text-[19px] font-semibold text-ink-strong">This lab board can&rsquo;t load right now</h1>
        <p className="mt-2 text-[13px] text-ink-muted">
          The server can&rsquo;t be reached. Try again once you are on the campus network.
        </p>
      </Container>
    );

  if (!data) return <UnknownCode kind="lab" />;

  return (
    <Container className="pb-10">
      <h1 className="m-0 pt-6 text-[28px] font-bold leading-8 tracking-[-0.015em] text-ink-strong sm:text-[32px] sm:leading-9">
        {data.name}
      </h1>
      <p className="mb-0 mt-2 text-[15px] text-ink-muted">{data.equipment.length} machines in this lab.</p>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-4 sm:mx-0 sm:flex-wrap sm:px-0">
        <FilterPill
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label={`All ${data.equipment.length}`}
        />
        {STATUSES.filter((s) => counts.get(s)).map((status) => (
          <FilterPill
            key={status}
            active={filter === status}
            onClick={() => setFilter(status)}
            label={`${STATUS[status].label} ${counts.get(status)}`}
          />
        ))}
      </div>

      <div>
        <label htmlFor="lab-search" className="sr-only">
          Search this lab
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-[14px] top-[14px] text-ink-muted">
            <Icon name="search" />
          </span>
          <input
            id="lab-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or asset ID"
            className="min-h-touch w-full rounded-md border border-line-strong bg-surface-raised py-3 pl-[44px] pr-4 text-[15px]"
          />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-line-subtle">
        {visible.length === 0 ? (
          <div className="bg-surface-raised p-8 text-center">
            <Icon name="inventory_2" size={40} className="text-ink-muted" />
            <p className="mb-0 mt-3 text-[16px] font-semibold text-ink-strong">Nothing matches that</p>
            <p className="mb-0 mt-1 text-[13px] text-ink-muted">Clear the filter or try another name.</p>
          </div>
        ) : (
          visible.map((item, index) => (
            <EquipmentRow
              key={item.qr_token}
              qrToken={item.qr_token}
              name={item.name}
              assetId={item.asset_id}
              location={item.location}
              nextServiceDue={item.next_service_due}
              status={item.status}
              photoUrl={equipmentPhotoUrl(item.photo_path)}
              last={index === visible.length - 1}
            />
          ))
        )}
      </div>
    </Container>
  );
}

function FilterPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'h-[36px] shrink-0 rounded-full border px-[14px] text-[14px] font-semibold',
        active ? 'border-brand bg-brand text-ink-ondark' : 'border-line-strong bg-surface-raised text-ink',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
