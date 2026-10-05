import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, signedUrl } from '@/lib/supabase';
import { formatDate } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { Field, controlClass } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Container, StickyActions } from '@/ui/Container';

interface OpenReport {
  event_id: string;
  vendor_company: string;
  engineer_name: string | null;
  service_date: string;
  work_done: string;
  report_path: string | null;
}

interface Machine {
  id: string;
  name: string;
  asset_id: string;
  qr_token: string;
  lab_id: string;
}

type Outcome = 'replaced' | 'retired' | 'kept_in_service';

const OUTCOMES: { value: Outcome; label: string; help: string; icon: string }[] = [
  { value: 'replaced', label: 'Replaced', help: 'A new machine took its place. This one is retired.', icon: 'swap_horiz' },
  { value: 'retired', label: 'Retired', help: 'Taken out of use with no replacement yet.', icon: 'inventory_2' },
  {
    value: 'kept_in_service',
    label: 'Kept in service',
    help: 'Still in use despite the recommendation. A reason is required.',
    icon: 'verified',
  },
];

/**
 * Closes a Replace recommendation. Recording the outcome stops the weekly
 * critical email, and Replaced or Retired takes the machine out of service
 * (0008_replacement_outcome.sql). The engineer's report itself never changes.
 * This needs the server: it is a decision, not a field note.
 */
export function ReplacementOutcomePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<Outcome>('replaced');
  const [note, setNote] = useState('');
  const [replacement, setReplacement] = useState('');
  const [error, setError] = useState<string>();

  const { data, isLoading } = useQuery({
    queryKey: ['replacement', id],
    queryFn: async () => {
      const { data: machine, error: mError } = await supabase
        .from('equipment')
        .select('id, name, asset_id, qr_token, lab_id')
        .eq('id', id)
        .single();
      if (mError) throw mError;

      const { data: reports, error: rError } = await supabase
        .from('service_reports')
        .select('event_id, vendor_company, engineer_name, service_date, work_done, report_path, events!inner(equipment_id)')
        .eq('events.equipment_id', id)
        .eq('recommendation', 'replace')
        .is('outcome', null)
        .order('service_date', { ascending: false });
      if (rError) throw rError;

      const m = machine as Machine;
      const { data: candidates } = await supabase
        .from('equipment')
        .select('id, name, asset_id, qr_token, lab_id')
        .eq('lab_id', m.lab_id)
        .neq('id', id)
        .is('retired_at', null)
        .order('created_at', { ascending: false });

      return { machine: m, reports: (reports ?? []) as unknown as OpenReport[], candidates: (candidates ?? []) as Machine[] };
    },
  });

  const report = data?.reports[0];

  const save = useMutation({
    mutationFn: async () => {
      if (!report) throw new Error('There is no open replacement recommendation for this machine.');
      const { error: updateError } = await supabase
        .from('service_reports')
        .update({
          outcome,
          outcome_note: note.trim() || null,
          outcome_at: new Date().toISOString(),
          replaced_by_equipment_id: outcome === 'replaced' ? replacement : null,
        })
        .eq('event_id', report.event_id);
      if (updateError) throw updateError;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      navigate(data ? `/e/${data.machine.qr_token}` : '/staff', { replace: true });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The outcome could not be saved.'),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    if (outcome === 'kept_in_service' && !note.trim()) return setError('Say why it is being kept in service.');
    if (outcome === 'replaced' && !replacement)
      return setError('Choose the machine that replaced it. Register the new one first if it is not listed.');
    save.mutate();
  }

  async function openReport() {
    if (!report?.report_path) return;
    const url = await signedUrl('event-files', report.report_path);
    if (url) window.open(url, '_blank', 'noopener');
  }

  if (isLoading) {
    return (
      <Container className="py-10">
        <p className="text-ink-muted">Loading…</p>
      </Container>
    );
  }

  return (
    <Container>
      <form onSubmit={onSubmit}>
        <p className="mono m-0 pt-6 text-[13px] text-ink-muted">
          {data ? `${data.machine.asset_id} · ${data.machine.name}` : ''}
        </p>
        <h1 className="m-0 mt-1 text-[24px] font-semibold leading-[30px] text-ink-strong">Replacement outcome</h1>

        {!report ? (
          <p className="mt-6 rounded-lg bg-calm-tint p-4 text-[15px] text-calm-ink">
            There is no open replacement recommendation for this machine. Nothing to record.
          </p>
        ) : (
          <div className="flex flex-col gap-6 pt-6">
            <div className="rounded-lg border border-line-subtle bg-surface-raised p-4">
              <p className="m-0 text-[14px] font-semibold text-urgent-ink">
                <Icon name="swap_horiz" size={18} /> Replace recommended
              </p>
              <p className="mb-0 mt-2 text-[15px] text-ink-strong">
                {report.vendor_company}
                {report.engineer_name ? `, ${report.engineer_name}` : ''} · {formatDate(report.service_date)}
              </p>
              <p className="mb-0 mt-1 text-[14px] leading-5 text-ink">{report.work_done}</p>
              {report.report_path ? (
                <Button intent="ghost" icon="description" className="mt-2" onClick={openReport}>
                  Open the engineer&rsquo;s report
                </Button>
              ) : null}
            </div>

            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 p-0 text-[14px] font-semibold text-ink-strong">
                What happened <span className="text-urgent-ink">*</span>
              </legend>
              <div className="flex flex-col gap-2">
                {OUTCOMES.map((o) => (
                  <label
                    key={o.value}
                    aria-label={o.label}
                    className={[
                      'flex cursor-pointer items-start gap-3 rounded-lg border p-4',
                      outcome === o.value ? 'border-brand bg-brand-surface' : 'border-line-strong bg-surface-raised',
                    ].join(' ')}
                  >
                    <input
                      type="radio"
                      name="outcome"
                      value={o.value}
                      checked={outcome === o.value}
                      onChange={() => setOutcome(o.value)}
                      className="mt-1"
                    />
                    <span>
                      <span className="flex items-center gap-2 text-[15px] font-semibold text-ink-strong">
                        <Icon name={o.icon} size={18} />
                        {o.label}
                      </span>
                      <span className="mt-1 block text-[13px] leading-[19px] text-ink-muted">{o.help}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {outcome === 'replaced' ? (
              <Field label="Replaced by" required help="The new machine, registered in the same lab.">
                {(control) => (
                  <select
                    {...control}
                    value={replacement}
                    onChange={(e) => setReplacement(e.target.value)}
                    className={`min-h-touch ${controlClass()}`}
                  >
                    <option value="">Choose a machine…</option>
                    {(data?.candidates ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.asset_id} · {m.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : null}

            <Field
              label={outcome === 'kept_in_service' ? 'Reason' : 'Note'}
              required={outcome === 'kept_in_service'}
              help={outcome === 'kept_in_service' ? 'For example: repaired by vendor, budget not approved yet.' : 'Optional.'}
            >
              {(control) => (
                <textarea
                  {...control}
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={controlClass()}
                />
              )}
            </Field>

            {outcome !== 'kept_in_service' ? (
              <p className="m-0 flex items-start gap-2 text-[13px] leading-[19px] text-ink-muted">
                <Icon name="info" size={18} className="shrink-0" />
                This machine will show as Retired. Its label keeps working and its full history stays readable.
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="m-0 flex items-start gap-2 text-[14px] font-medium text-urgent-ink">
                <Icon name="error" filled size={18} />
                {error}
              </p>
            ) : null}
          </div>
        )}

        <StickyActions>
          <Button intent="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          {report ? (
            <Button type="submit" intent="primary" icon="task_alt" block disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save outcome'}
            </Button>
          ) : null}
        </StickyActions>
      </form>
    </Container>
  );
}
