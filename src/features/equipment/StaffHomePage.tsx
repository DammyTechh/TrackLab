import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/Container';
import { EquipmentRow } from '@/ui/EquipmentRow';
import { equipmentPhotoUrl } from '@/lib/supabase';
import { STATUS } from '@/lib/status';
import { useAuth } from '@/app/AuthProvider';
import { useMyEquipment } from './useMyEquipment';

/**
 * A technician's or HOD's landing screen: what needs attention, then every
 * machine in their labs. Tapping a row opens its passport, where they record
 * events and take the photo.
 */
export function StaffHomePage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data, isLoading } = useMyEquipment();
  const [search, setSearch] = useState('');

  const items = data?.items ?? [];
  const urgent = items.filter((item) => STATUS[item.status].signal === 'urgent');
  const noPhoto = items.filter((item) => !item.photo_path).length;
  const q = search.trim().toLowerCase();
  const visible = items
    .filter(
      (item) =>
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.asset_id.toLowerCase().includes(q) ||
        (item.location ?? '').toLowerCase().includes(q),
    )
    // Most urgent first, so nobody has to scroll to find the broken one.
    .sort((a, b) => STATUS[b.status].rank - STATUS[a.status].rank || a.name.localeCompare(b.name));

  return (
    <Container width="app" className="py-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-[28px] font-bold leading-8 tracking-[-0.015em] text-ink-strong">My equipment</h1>
          <p className="mb-0 mt-2 text-[15px] text-ink-muted">
            {isLoading
              ? 'Loading your labs…'
              : `${profile?.full_name ?? ''}${profile ? ' · ' : ''}${items.length} machines in your labs.`}
          </p>
        </div>
        <Button intent="primary" icon="add" onClick={() => navigate('/staff/equipment/new')}>
          Register equipment
        </Button>
      </div>

      {data?.fromCache ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-attention-tint p-3 text-[13px] leading-[19px] text-attention-ink">
          <Icon name="cloud_off" size={18} />
          Showing the copy saved on this device. It may be behind the server.
        </p>
      ) : null}

      {urgent.length > 0 ? (
        <p className="mb-0 mt-6 flex items-start gap-3 rounded-lg bg-urgent-tint p-4 text-[15px] leading-[23px] text-urgent-ink">
          <Icon name="error" filled />
          <span>
            <strong>{urgent.length} need attention now.</strong> Faulty, overdue or recommended for replacement;
            they are at the top of the list.
          </span>
        </p>
      ) : null}

      {noPhoto > 0 ? (
        <p className="mb-0 mt-3 flex items-start gap-3 rounded-lg border border-line-subtle bg-surface-raised p-4 text-[14px] leading-5 text-ink-muted">
          <Icon name="add_a_photo" className="text-brand" />
          {noPhoto} {noPhoto === 1 ? 'machine has' : 'machines have'} no photo yet. Open one and tap Take photo.
        </p>
      ) : null}

      <div className="mt-6">
        <label htmlFor="staff-search" className="sr-only">
          Search equipment
        </label>
        <div className="flex min-h-touch items-center gap-2 rounded-md border border-line-strong bg-surface-raised px-4">
          <Icon name="search" className="text-ink-muted" />
          <input
            id="staff-search"
            type="search"
            placeholder="Search by name, asset ID or location"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent py-3 text-[15px] text-ink-strong outline-none placeholder:text-ink-muted"
          />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-line-subtle">
        {!isLoading && visible.length === 0 ? (
          <div className="bg-surface-raised px-6 py-12 text-center">
            <Icon name="inventory_2" size={40} className="text-ink-muted" />
            <p className="mb-0 mt-3 text-[15px] text-ink-muted">
              {items.length === 0
                ? 'No equipment registered in your labs yet. Register the first machine to get its label.'
                : 'Nothing matches that search.'}
            </p>
          </div>
        ) : (
          visible.map((item, index) => (
            <EquipmentRow
              key={item.id}
              qrToken={item.qr_token}
              name={item.name}
              assetId={item.asset_id}
              location={item.lab ? `${item.lab.code}${item.location ? ` · ${item.location}` : ''}` : item.location}
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
