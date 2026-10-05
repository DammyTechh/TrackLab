import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/Button';
import { Field, controlClass } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/Container';
import { useNetwork } from '@/app/NetworkProvider';
import { useAuth } from '@/app/AuthProvider';
import { db } from '@/offline/db';
import { EDITABLE_FIELDS, FIELD_LABEL, mergeEdit, type Conflict, type EditableValues } from './editMerge';

interface Loaded extends EditableValues {
  id: string;
  lab_id: string;
  qr_token: string;
  asset_id: string;
  lab: { name: string } | null;
}

const SELECT = `id, lab_id, qr_token, asset_id, lab:labs(name), ${EDITABLE_FIELDS.join(', ')}`;

async function fetchMachine(id: string): Promise<Loaded | null> {
  const { data, error } = await supabase.from('equipment').select(SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as unknown as Loaded | null) ?? null;
}

const pick = (row: EditableValues): EditableValues =>
  Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, row[f]])) as EditableValues;

/**
 * Correct a machine's details after registration: a typo in the name, a move
 * to another bench, a serial number read off the plate later, a different
 * service interval.
 *
 * Not editable here, by design: the asset ID and the lab (both printed on the
 * label), and status and service dates (they follow from recorded events).
 * The database refuses those regardless of what this screen does (0009).
 *
 * Editing needs a connection. It changes what every visitor sees, and an edit
 * replayed from a phone's queue hours later could silently undo a colleague's
 * correction. Concurrent edits are merged field by field; only a field two
 * people changed differently is put back to the person to decide.
 */
export function EditEquipmentPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { state } = useNetwork();
  const { profile } = useAuth();

  const machine = useQuery({
    queryKey: ['equipment-edit', id],
    queryFn: () => fetchMachine(id),
    staleTime: 0,
  });

  const [form, setForm] = useState<EditableValues | null>(null);
  const [base, setBase] = useState<EditableValues | null>(null);
  const [error, setError] = useState<string>();
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (machine.data && !base) {
      const values = pick(machine.data);
      setBase(values);
      setForm(values);
    }
  }, [machine.data, base]);

  if (machine.isLoading || (machine.data && !form)) {
    return (
      <Container className="py-10">
        <p className="text-ink-muted">Loading this machine…</p>
      </Container>
    );
  }

  const canWrite =
    machine.data &&
    (profile?.role === 'technician' || profile?.role === 'lab_hod') &&
    profile.lab_ids.includes(machine.data.lab_id);

  if (!machine.data || !form || !base || !canWrite) {
    return (
      <Container className="py-16 text-center">
        <Icon name="lock" size={40} className="text-ink-muted" />
        <h1 className="mt-4 text-[24px] font-semibold leading-[30px] text-ink-strong">
          {machine.isError ? 'This machine could not be loaded' : 'You cannot edit this machine'}
        </h1>
        <p className="mx-auto mt-2 max-w-[22rem] text-[15px] leading-[23px] text-ink-muted">
          {machine.isError
            ? 'Editing needs a connection to the server. Try again on the campus network.'
            : 'Only technicians and the HOD of the lab it belongs to can change its details.'}
        </p>
      </Container>
    );
  }

  const loaded = machine.data;
  const set = <K extends keyof EditableValues>(field: K, value: EditableValues[K]) =>
    setForm((current) => (current ? { ...current, [field]: value } : current));

  async function save(overwrite: boolean) {
    if (!form || !base) return;
    setError(undefined);

    if (!form.name?.trim()) return setError('The machine needs a name.');
    const days = Number(form.service_interval_days);
    if (!Number.isInteger(days) || days < 1)
      return setError('Service interval must be a whole number of days.');
    if (state === 'offline')
      return setError('Editing details needs a connection. Your changes are still in the form.');

    const mine: EditableValues = {
      ...form,
      name: form.name.trim(),
      service_interval_days: days,
      ...Object.fromEntries(
        (['manufacturer', 'model', 'serial_no', 'location', 'operating_conditions'] as const).map((f) => [
          f,
          form[f]?.trim() ? form[f]!.trim() : null,
        ]),
      ),
    };

    setBusy(true);
    try {
      const current = await fetchMachine(id);
      if (!current) throw new Error('This machine is no longer available to you.');

      const { changes, conflicts: found } = mergeEdit(base, mine, pick(current));
      if (found.length > 0 && !overwrite) {
        setConflicts(found);
        return;
      }
      if (Object.keys(changes).length === 0) {
        navigate(`/e/${loaded.qr_token}`);
        return;
      }

      const { data, error: updateError } = await supabase
        .from('equipment')
        .update(changes)
        .eq('id', id)
        .select('id');
      if (updateError) throw updateError;
      // RLS filters a forbidden update to zero rows rather than raising.
      if (!data || data.length === 0) throw new Error('You are not allowed to edit this machine.');

      const cached = await db.equipment.get(id);
      // The device copy too, so the change shows offline straight away.
      // name is never null here: the form refuses to save an empty one.
      if (cached) await db.equipment.put({ ...cached, ...changes, name: changes.name ?? cached.name });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['passport'] }),
        queryClient.invalidateQueries({ queryKey: ['my-equipment'] }),
        queryClient.invalidateQueries({ queryKey: ['equipment-edit', id] }),
      ]);
      navigate(`/e/${loaded.qr_token}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Those changes could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void save(false);
  }

  function takeTheirs() {
    if (!form) return;
    const next = { ...form };
    for (const c of conflicts) (next as Record<string, unknown>)[c.field] = c.theirs;
    setForm(next);
    setBase((b) => (b ? { ...b, ...Object.fromEntries(conflicts.map((c) => [c.field, c.theirs])) } : b));
    setConflicts([]);
  }

  return (
    <Container className="py-6 sm:py-8">
      <p className="mono m-0 text-[13px] font-medium tracking-[0.02em] text-ink-muted">{loaded.asset_id}</p>
      <h1 className="mt-1 text-[28px] font-bold leading-8 tracking-[-0.015em] text-ink-strong">
        Edit details
      </h1>

      <dl className="mt-5 grid grid-cols-2 gap-3 rounded-lg bg-surface-sunken p-4 text-[14px]">
        <div>
          <dt className="text-ink-muted">Asset ID</dt>
          <dd className="mono m-0 font-medium text-ink-strong">{loaded.asset_id}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Lab</dt>
          <dd className="m-0 font-medium text-ink-strong">{loaded.lab?.name ?? '—'}</dd>
        </div>
        <p className="col-span-2 m-0 flex items-start gap-2 text-[13px] leading-[19px] text-ink-muted">
          <Icon name="lock" size={18} className="shrink-0" />
          Fixed at registration because they are printed on the label. Status and service dates come from
          recorded events, not from this form.
        </p>
      </dl>

      {conflicts.length > 0 ? (
        <div
          role="alert"
          className="mt-6 rounded-lg border border-attention-ink bg-attention-tint p-4 text-attention-ink"
        >
          <p className="m-0 flex items-start gap-2 text-[15px] font-semibold leading-[21px]">
            <Icon name="group" size={20} className="shrink-0" />
            Someone else changed {conflicts.length === 1 ? 'this field' : 'these fields'} while you were
            editing
          </p>
          <ul className="mb-0 mt-3 flex list-none flex-col gap-2 p-0 text-[14px] leading-5">
            {conflicts.map((c) => (
              <li key={c.field}>
                <strong>{FIELD_LABEL[c.field]}:</strong> now &ldquo;{String(c.theirs ?? '—')}&rdquo;, you
                entered &ldquo;{String(c.mine ?? '—')}&rdquo;
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button intent="secondary" onClick={takeTheirs}>
              Use theirs
            </Button>
            <Button intent="primary" disabled={busy} onClick={() => void save(true)}>
              Save mine anyway
            </Button>
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-5">
        <Field label="Name" required value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Manufacturer"
            value={form.manufacturer ?? ''}
            onChange={(e) => set('manufacturer', e.target.value)}
          />
          <Field label="Model" mono value={form.model ?? ''} onChange={(e) => set('model', e.target.value)} />
          <Field
            label="Serial number"
            mono
            value={form.serial_no ?? ''}
            onChange={(e) => set('serial_no', e.target.value)}
          />
          <Field
            label="Location in the lab"
            value={form.location ?? ''}
            onChange={(e) => set('location', e.target.value)}
            help="e.g. Bench 3"
          />
        </div>

        <Field label="Safe operating conditions" help="Shown to everyone who scans the label.">
          {(control) => (
            <textarea
              {...control}
              rows={3}
              value={form.operating_conditions ?? ''}
              onChange={(e) => set('operating_conditions', e.target.value)}
              className={controlClass()}
            />
          )}
        </Field>

        <Field
          label="Service interval (days)"
          type="number"
          inputMode="numeric"
          min={1}
          value={String(form.service_interval_days)}
          onChange={(e) => set('service_interval_days', e.target.value === '' ? NaN : Number(e.target.value))}
          help={
            Number(form.service_interval_days) !== base.service_interval_days
              ? 'Saving moves the next due date, unless an engineer set one explicitly.'
              : 'Used to work out the next due date after each service.'
          }
        />

        {error ? (
          <p role="alert" className="m-0 flex items-start gap-2 text-[14px] font-medium text-urgent-ink">
            <Icon name="error" filled size={18} className="shrink-0" />
            {error}
          </p>
        ) : null}

        <div className="flex gap-3">
          <Button intent="secondary" onClick={() => navigate(`/e/${loaded.qr_token}`)}>
            Cancel
          </Button>
          <Button type="submit" intent="primary" icon="save" block disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Container>
  );
}
