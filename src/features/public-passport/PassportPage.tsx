import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchPassport } from './api';
import { StatusBadge } from '@/ui/StatusBadge';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Container, StickyActions } from '@/ui/Container';
import { useAuth } from '@/app/AuthProvider';
import { formatDate, daysUntil } from '@/lib/dates';
import { EVENT_ICON, EVENT_LABEL, serviceLine } from '@/lib/status';
import { EquipmentDocuments, EquipmentPhoto, openDocument, useEquipmentRef } from '@/features/equipment';

/**
 * The most-used screen in the product and the only one most people ever see.
 * Order is fixed: identity, status, then everything else. Nobody should have
 * to scroll to find out whether a machine is faulty.
 */
export function PassportPage() {
  const { qrToken = '' } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canUpdate = profile?.role === 'technician' || profile?.role === 'lab_hod';
  // The internal id and lab, for staff only. canWrite = in this machine's lab.
  const { ref: equipment, canWrite } = useEquipmentRef(qrToken);
  const [panelOpen, setPanelOpen] = useState(false);
  const [sopError, setSopError] = useState<string>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['passport', qrToken],
    queryFn: () => fetchPassport(qrToken),
  });

  if (isLoading)
    return (
      <Container className="py-10">
        <p className="text-ink-muted">Loading this machine…</p>
      </Container>
    );

  if (!isError && !data) return <UnknownCode kind="label" />;

  if (isError || !data) {
    return (
      <Container className="py-16 text-center">
        <Icon name="wifi_off" size={40} className="text-ink-muted" />
        <h1 className="mt-4 text-[19px] font-semibold text-ink-strong">
          This label can&rsquo;t be read right now
        </h1>
        <p className="mt-2 text-[13px] text-ink-muted">
          The code is valid, but the server can&rsquo;t be reached. Try again once you are on the campus
          network.
        </p>
      </Container>
    );
  }

  const overdueBy =
    data.next_service_due && data.status === 'overdue' ? -daysUntil(data.next_service_due) : null;

  return (
    <Container className="pb-0">
      {/* The plate: the machine's identity, imitating an engraved asset plate. */}
      <div className="pt-4">
        <EquipmentPhoto
          equipmentId={equipment?.id}
          equipmentName={data.name}
          photoPath={data.photo_path}
          canEdit={canWrite}
        />

        <div className="rounded-xl bg-surface-plate px-5 pb-10 pt-6">
          <p className="mono m-0 text-[15px] font-medium leading-5 tracking-[0.02em] text-accent">
            {data.asset_id}
          </p>
          <h1 className="mb-0 mt-2 text-[28px] font-bold leading-8 tracking-[-0.02em] text-ink-ondark">
            {data.name}
          </h1>
          <p className="mb-0 mt-3 flex items-center gap-2 text-[15px] leading-[23px] text-plate-muted">
            <Icon name="location_on" size={18} />
            {data.lab.name}
            {data.location ? ` · ${data.location}` : ''}
          </p>
        </div>

        {/* The sticker straddles the plate edge: a label applied to the object. */}
        <div className="-mt-5 pl-3">
          <StatusBadge status={data.status} sticker suffix={overdueBy ? `by ${overdueBy} days` : undefined} />
        </div>
        <p className="mono mb-0 ml-4 mt-3 text-[13px] leading-[18px] text-ink-muted">
          {serviceLine(data.status, data.next_service_due, data.last_service_at, formatDate)}
        </p>
      </div>

      {data.fromCache ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-attention-tint p-3 text-[13px] leading-[19px] text-attention-ink">
          <Icon name="cloud_off" size={18} />
          Showing the copy saved on this device. It may be behind the server.
        </p>
      ) : null}

      <Section title="Safe operating conditions">
        <p className="m-0 text-[17px] leading-[27px] text-ink">
          {data.operating_conditions ?? 'Not recorded yet.'}
        </p>
      </Section>

      {equipment && profile ? (
        // Staff: every document, with add and withdraw for this lab's team.
        <Section title="Documents">
          <EquipmentDocuments equipmentId={equipment.id} canEdit={canWrite} />
        </Section>
      ) : data.documents.length > 0 ? (
        // Visitors: the SOPs only, which is all the storage policy lets them open.
        <Section title="Standard operating procedures">
          <ul className="m-0 flex list-none flex-col gap-[10px] p-0">
            {data.documents.map((doc) => (
              <li key={doc.file_path}>
                <button
                  type="button"
                  onClick={() => {
                    setSopError(undefined);
                    openDocument(doc.file_path).catch((err: Error) => setSopError(err.message));
                  }}
                  className="flex min-h-touch w-full items-center gap-3 rounded-lg border border-line-subtle bg-surface-raised px-4 py-3 text-left"
                >
                  <Icon name="picture_as_pdf" size={28} className="text-urgent-ink" />
                  <span className="flex-1 text-[15px] font-semibold leading-[21px] text-ink-strong">
                    {doc.title}
                  </span>
                  <Icon name="open_in_new" className="text-ink-muted" />
                </button>
              </li>
            ))}
          </ul>
          {sopError ? (
            <p role="alert" className="mb-0 mt-2 flex items-start gap-2 text-[13px] text-urgent-ink">
              <Icon name="error" filled size={18} className="shrink-0" />
              {sopError}
            </p>
          ) : null}
        </Section>
      ) : null}

      <Section
        title="Specification"
        action={
          canWrite && equipment ? (
            <Button
              intent="ghost"
              icon="edit"
              onClick={() => navigate(`/staff/equipment/${equipment.id}/edit`)}
            >
              Edit details
            </Button>
          ) : null
        }
      >
        <dl className="m-0 rounded-lg border border-line-subtle bg-surface-raised px-4">
          <Row label="Manufacturer" value={data.manufacturer} />
          <Row label="Model" value={data.model} mono />
          <Row label="Serial number" value={data.serial_no} mono last />
        </dl>
      </Section>

      <Section title="History">
        <ol className="m-0 list-none rounded-lg border border-line-subtle bg-surface-raised p-0 px-4">
          {data.history.map((event, index) => (
            <li
              key={`${event.occurred_at}-${index}`}
              className={`flex gap-4 py-4 ${index === data.history.length - 1 ? '' : 'border-b border-line-subtle'}`}
            >
              <span className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink">
                <Icon name={EVENT_ICON[event.type as keyof typeof EVENT_ICON] ?? 'circle'} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-[16px] font-semibold leading-[22px] text-ink-strong">
                    {EVENT_LABEL[event.type as keyof typeof EVENT_LABEL] ?? event.type}
                    {event.severity ? ` · ${event.severity}` : ''}
                  </span>
                  <span className="mono shrink-0 text-[13px] text-ink-muted">
                    {formatDate(event.occurred_at)}
                  </span>
                </span>
                {event.summary ? (
                  <span className="mt-1 block text-[15px] leading-[23px]">{event.summary}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      {canWrite && equipment && data.status === 'replace' ? (
        <p className="mb-0 mt-8 flex flex-col gap-3 rounded-lg bg-urgent-tint p-4 text-[14px] leading-5 text-urgent-ink">
          <span className="flex items-start gap-2">
            <Icon name="swap_horiz" />
            An engineer recommended replacing this machine. Record what happened once it is decided.
          </span>
          <Button
            intent="danger"
            icon="task_alt"
            onClick={() => navigate(`/staff/equipment/${equipment.id}/replacement`)}
          >
            Record replacement outcome
          </Button>
        </p>
      ) : null}

      <StickyActions>
        {canWrite && equipment ? (
          <div className="flex w-full flex-col gap-3">
            {panelOpen ? (
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-3"
                role="group"
                aria-label="Choose what to record"
              >
                {UPDATE_TYPES.map((t) => (
                  <Button
                    key={t.type}
                    intent="secondary"
                    icon={t.icon}
                    onClick={() => navigate(`/staff/equipment/${equipment.id}/event/${t.type}`)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
            ) : null}
            <Button
              intent={panelOpen ? 'secondary' : 'primary'}
              icon={panelOpen ? 'close' : 'edit_note'}
              block
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen(!panelOpen)}
            >
              {panelOpen ? 'Close' : 'Record an event'}
            </Button>
          </div>
        ) : profile ? (
          <p className="m-0 flex min-h-touch w-full items-center justify-center gap-2 text-[14px] text-ink-muted">
            <Icon name="visibility" size={18} />
            {canUpdate ? 'This machine is in another lab. You can view it but not update it.' : 'View only.'}
          </p>
        ) : (
          <Button
            intent="secondary"
            icon="lock"
            block
            onClick={() => navigate('/login', { state: { from: `/e/${qrToken}` } })}
          >
            Staff sign in to update
          </Button>
        )}
      </StickyActions>
    </Container>
  );
}

/** The code was read, but no machine or lab carries it. */
export function UnknownCode({ kind }: { kind: 'label' | 'lab' }) {
  return (
    <Container className="py-16 text-center">
      <Icon name="qr_code_scanner" size={40} className="text-ink-muted" />
      <h1 className="mt-4 text-[24px] font-semibold leading-[30px] text-ink-strong">
        {kind === 'label' ? 'That label does not match any equipment' : 'That code does not match any lab'}
      </h1>
      <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-[23px] text-ink-muted">
        {kind === 'label'
          ? 'Check that you scanned the whole code. If the label is damaged, find the asset ID printed on it in the lab entrance board.'
          : 'Check that you scanned the whole code on the lab door, or ask the lab technician.'}
      </p>
    </Container>
  );
}

const UPDATE_TYPES = [
  { type: 'use', label: 'Log use', icon: 'play_circle' },
  { type: 'fault', label: 'Report fault', icon: 'report' },
  { type: 'maintenance', label: 'Maintenance', icon: 'build' },
  { type: 'inspection', label: 'Inspection', icon: 'fact_check' },
  { type: 'service_report', label: 'Service report', icon: 'engineering' },
] as const;

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="pt-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="m-0 text-[19px] font-semibold leading-[26px] text-ink-strong">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  value,
  mono,
  last,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  last?: boolean;
}) {
  if (!value) return null;
  return (
    <div className={`flex justify-between gap-4 py-3 ${last ? '' : 'border-b border-line-subtle'}`}>
      <dt className="m-0 text-[15px] text-ink-muted">{label}</dt>
      <dd className={`m-0 text-right text-[15px] font-medium text-ink-strong ${mono ? 'mono' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
