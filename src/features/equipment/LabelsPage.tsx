import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { institution } from '@/lib/institution';
import { formatDate } from '@/lib/dates';
import { Brandmark } from '@/ui/Brandmark';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/Container';
import { useAuth } from '@/app/AuthProvider';
import { labBoardUrl, labelsWouldPointAtLocalhost, passportUrl, publicBaseUrl, renderQrSvg } from './qr';

interface LabelMachine {
  id: string;
  asset_id: string;
  name: string;
  qr_token: string;
  location: string | null;
  label_printed_at: string | null;
  lab: { name: string; code: string } | null;
}

interface LabCard {
  id: string;
  name: string;
  code: string;
  building: string | null;
  room: string | null;
  public_token: string;
}

type Layout = 'sheet' | 'single';

/**
 * Print once, stick on, never reprint. Each equipment label and each lab
 * entrance card carries a permanent code (the database refuses to change
 * it), so every later update shows up through the label already on the wall.
 *
 * Printing goes through the browser: choose "Save as PDF" in the print
 * dialog for a PDF. A4 sheets hold eight labels; "one per page" suits a
 * label printer.
 */
export function LabelsPage() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [tab, setTab] = useState<'equipment' | 'labs'>('equipment');
  const [onlyUnprinted, setOnlyUnprinted] = useState(true);
  const [layout, setLayout] = useState<Layout>('sheet');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedLabs, setSelectedLabs] = useState<Set<string>>(new Set());

  const machines = useQuery({
    queryKey: ['label-machines'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equipment')
        .select('id, asset_id, name, qr_token, location, label_printed_at, lab:labs(name, code)')
        .is('retired_at', null)
        .order('asset_id');
      if (error) throw error;
      return data as unknown as LabelMachine[];
    },
  });

  const labs = useQuery({
    queryKey: ['label-labs', profile?.lab_ids],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labs')
        .select('id, name, code, building, room, public_token')
        .in('id', profile?.lab_ids ?? [])
        .order('code');
      if (error) throw error;
      return data as LabCard[];
    },
  });

  const list = useMemo(
    () => (machines.data ?? []).filter((m) => !onlyUnprinted || !m.label_printed_at),
    [machines.data, onlyUnprinted],
  );

  // Start with everything in view ticked; that is what people print.
  useEffect(() => setSelected(new Set(list.map((m) => m.id))), [list]);
  useEffect(() => setSelectedLabs(new Set((labs.data ?? []).map((l) => l.id))), [labs.data]);

  const toPrint = list.filter((m) => selected.has(m.id));
  const labsToPrint = (labs.data ?? []).filter((l) => selectedLabs.has(l.id));

  const markPrinted = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('equipment')
        .update({ label_printed_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['label-machines'] }),
  });

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  const printCount = tab === 'equipment' ? toPrint.length : labsToPrint.length;

  return (
    <>
      <Container width="app" className="py-6 print:hidden sm:py-8">
        <h1 className="m-0 text-[28px] font-bold leading-8 tracking-[-0.015em] text-ink-strong">Print labels</h1>
        <p className="mb-0 mt-2 max-w-[44rem] text-[15px] leading-[23px] text-ink-muted">
          Each code is permanent. Print it once, stick it on, and every later update shows through the same label. To
          get a PDF, choose Save as PDF in the print dialog.
        </p>

        {labelsWouldPointAtLocalhost() ? (
          <p className="mb-0 mt-4 flex items-start gap-3 rounded-lg bg-urgent-tint p-4 text-[14px] leading-5 text-urgent-ink">
            <Icon name="error" filled className="shrink-0" />
            <span>
              <strong>Do not print these for real yet.</strong> The codes would point at{' '}
              <span className="mono break-all">{publicBaseUrl()}</span>, which only works on this computer. Set{' '}
              <span className="mono">VITE_PUBLIC_BASE_URL</span> to the live address (for example{' '}
              <span className="mono break-all">https://evidencetag.yourschool.edu.ng</span>) and restart. Test prints are fine.
            </span>
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2" role="tablist">
          {(
            [
              ['equipment', 'Equipment labels', 'qr_code_2'],
              ['labs', 'Lab entrance cards', 'door_front'],
            ] as const
          ).map(([key, label, icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={[
                'inline-flex min-h-touch items-center gap-2 rounded-full border px-4 text-[14px] font-semibold',
                tab === key ? 'border-brand bg-brand text-ink-ondark' : 'border-line-strong bg-surface-raised text-ink',
              ].join(' ')}
            >
              <Icon name={icon} size={18} />
              {label}
            </button>
          ))}
        </div>

        {tab === 'equipment' ? (
          <>
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-[14px] text-ink">
              <label className="flex min-h-touch items-center gap-2">
                <input type="checkbox" checked={onlyUnprinted} onChange={(e) => setOnlyUnprinted(e.target.checked)} />
                Only machines not printed yet
              </label>
              <label className="flex items-center gap-2">
                Layout
                <select
                  value={layout}
                  onChange={(e) => setLayout(e.target.value as Layout)}
                  className="min-h-touch rounded-md border border-line-strong bg-surface-raised px-3"
                >
                  <option value="sheet">A4 sheet, 8 per page</option>
                  <option value="single">One per page</option>
                </select>
              </label>
              <span className="flex gap-3">
                <button type="button" className="font-semibold text-brand underline" onClick={() => setSelected(new Set(list.map((m) => m.id)))}>
                  Select all
                </button>
                <button type="button" className="font-semibold text-brand underline" onClick={() => setSelected(new Set())}>
                  Select none
                </button>
              </span>
            </div>

            <div className="mt-4 overflow-hidden rounded-lg border border-line-subtle bg-surface-raised">
              {list.length === 0 ? (
                <p className="m-0 px-6 py-10 text-center text-[15px] text-ink-muted">
                  {machines.isLoading
                    ? 'Loading…'
                    : onlyUnprinted
                      ? 'Every label has been printed. Untick the filter to reprint a damaged one.'
                      : 'No equipment registered yet.'}
                </p>
              ) : (
                list.map((m) => (
                  <label
                    key={m.id}
                    className="flex min-h-[56px] cursor-pointer items-center gap-4 border-b border-line-subtle px-4 last:border-b-0"
                  >
                    <input type="checkbox" checked={selected.has(m.id)} onChange={() => setSelected(toggle(selected, m.id))} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink-strong">{m.name}</span>
                      <span className="mono block text-[13px] text-ink-muted">
                        {m.asset_id}
                        {m.lab ? ` · ${m.lab.code}` : ''}
                      </span>
                    </span>
                    <span className="text-[13px] text-ink-muted">
                      {m.label_printed_at ? `Printed ${formatDate(m.label_printed_at)}` : 'Not printed'}
                    </span>
                  </label>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="mt-5 overflow-hidden rounded-lg border border-line-subtle bg-surface-raised">
            {(labs.data ?? []).length === 0 ? (
              <p className="m-0 px-6 py-10 text-center text-[15px] text-ink-muted">You are not a member of any lab.</p>
            ) : (
              (labs.data ?? []).map((lab) => (
                <label
                  key={lab.id}
                  className="flex min-h-[56px] cursor-pointer items-center gap-4 border-b border-line-subtle px-4 last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={selectedLabs.has(lab.id)}
                    onChange={() => setSelectedLabs(toggle(selectedLabs, lab.id))}
                  />
                  <span className="flex-1 font-semibold text-ink-strong">{lab.name}</span>
                  <span className="mono text-[13px] text-ink-muted">{lab.code}</span>
                </label>
              ))
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <Button intent="scan" icon="print" disabled={printCount === 0} onClick={() => window.print()}>
            Print {printCount} {tab === 'equipment' ? (printCount === 1 ? 'label' : 'labels') : printCount === 1 ? 'card' : 'cards'}
          </Button>
          {tab === 'equipment' ? (
            <Button
              intent="secondary"
              icon="done_all"
              disabled={toPrint.length === 0 || markPrinted.isPending}
              onClick={() => markPrinted.mutate(toPrint.map((m) => m.id))}
            >
              Mark {toPrint.length} as printed
            </Button>
          ) : null}
        </div>
        {tab === 'equipment' ? (
          <p className="mb-0 mt-2 text-[13px] text-ink-muted">
            After the labels come out of the printer, mark them as printed so they drop off this list.
          </p>
        ) : null}

        <h2 className="mb-3 mt-10 text-[19px] font-semibold text-ink-strong">Preview</h2>
      </Container>

      {/* What actually prints. Shown on screen too, as the preview. */}
      <div className="mx-auto w-full max-w-[210mm] px-4 pb-12 print:max-w-none print:p-0">
        {tab === 'equipment' ? (
          <div className={layout === 'sheet' ? 'grid grid-cols-1 gap-[4mm] sm:grid-cols-2 print:grid-cols-2' : 'flex flex-col'}>
            {toPrint.map((m) => (
              <EquipmentLabel key={m.id} machine={m} single={layout === 'single'} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-6 print:gap-0">
            {labsToPrint.map((lab) => (
              <LabEntranceCard key={lab.id} lab={lab} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function QrSvg({ url, className }: { url: string; className?: string }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    let live = true;
    void renderQrSvg(url).then((s) => live && setSvg(s));
    return () => {
      live = false;
    };
  }, [url]);
  // Generated locally by the qrcode library from our own URL.
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}

function EquipmentLabel({ machine, single }: { machine: LabelMachine; single: boolean }) {
  return (
    <div
      className={[
        'flex items-center gap-[4mm] rounded-lg border-[2mm] border-accent bg-surface-raised p-[3mm] [break-inside:avoid]',
        single ? 'mx-auto mb-6 h-[70mm] w-full max-w-[100mm] print:mb-0 print:w-[100mm] print:[break-after:page]' : 'h-[64mm]',
      ].join(' ')}
    >
      <QrSvg url={passportUrl(machine.qr_token)} className="h-[44mm] w-[44mm] shrink-0 [&>svg]:h-full [&>svg]:w-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-[2mm]">
        <Brandmark height={22} />
        <p className="mono m-0 text-[14px] font-semibold leading-tight text-ink-strong">{machine.asset_id}</p>
        <p className="m-0 line-clamp-3 text-[13px] font-semibold leading-tight text-ink-strong">{machine.name}</p>
        {machine.lab ? <p className="m-0 text-[11px] leading-tight text-ink-muted">{machine.lab.name}</p> : null}
        <p className="m-0 text-[11px] leading-tight text-ink-muted">Scan for status, safety and service history</p>
      </div>
    </div>
  );
}

function LabEntranceCard({ lab }: { lab: LabCard }) {
  return (
    <div className="mx-auto flex w-full max-w-[190mm] flex-col items-center rounded-xl border-[3mm] border-accent bg-surface-raised p-[6mm] text-center sm:p-[10mm] [break-inside:avoid] print:h-[270mm] print:justify-center print:[break-after:page]">
      <Brandmark height={40} />
      <h3 className="mb-0 mt-[6mm] text-[24px] font-bold leading-tight text-ink-strong sm:text-[32px]">{lab.name}</h3>
      <p className="mb-0 mt-[2mm] text-[16px] text-ink-muted">
        {[lab.building, lab.room].filter(Boolean).join(' · ')}
      </p>
      <QrSvg url={labBoardUrl(lab.public_token)} className="mt-[8mm] aspect-square w-full max-w-[110mm] [&>svg]:h-full [&>svg]:w-full" />
      <p className="mb-0 mt-[6mm] text-[16px] font-semibold text-ink-strong sm:text-[20px]">
        Scan to see every machine in this lab and whether it is safe to use
      </p>
      <p className="mb-0 mt-[2mm] text-[13px] text-ink-muted">{institution.name}</p>
    </div>
  );
}
