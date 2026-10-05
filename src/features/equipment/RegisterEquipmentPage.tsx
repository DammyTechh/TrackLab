import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { buildAssetId, institution } from '@/lib/institution';
import { formatDate } from '@/lib/dates';
import { Button } from '@/ui/Button';
import { Field, controlClass } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/Container';
import { PhotoSource } from '@/ui/PhotoSource';
import { useAuth } from '@/app/AuthProvider';
import { useNetwork } from '@/app/NetworkProvider';
import { db } from '@/offline/db';
import { sync } from '@/offline/sync';
import { enqueueEvent } from '@/offline/outbox';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { generateQrToken, passportUrl, renderQrSvg } from './qr';
import { queueEquipmentPhoto } from './photo';
import { planInitialHistory } from './initialHistory';

/** Today as a calendar date where the lab is, not where the server is. */
const todayInLab = () => format(toZonedTime(new Date(), institution.timezone), 'yyyy-MM-dd');

interface Lab {
  id: string;
  name: string;
  code: string;
}

interface Registered {
  qr_token: string;
  asset_id: string;
  name: string;
  labName: string;
  firstDue: string | null;
}

/**
 * Registering a machine assigns its asset ID and its permanent QR token, then
 * shows the label to print. It needs the server (the asset ID must be unique
 * across every device), so it is the one staff action that does not work
 * offline. The optional photo still goes through the offline outbox.
 */
export function RegisterEquipmentPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { state } = useNetwork();

  const { data: labs = [] } = useQuery({
    queryKey: ['my-labs', profile?.lab_ids],
    enabled: Boolean(profile),
    queryFn: async (): Promise<Lab[]> => {
      const { data, error } = await supabase
        .from('labs')
        .select('id, name, code')
        .in('id', profile?.lab_ids ?? [])
        .order('name');
      if (error) throw error;
      return data as Lab[];
    },
  });

  const [labId, setLabId] = useState('');
  const [name, setName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [location, setLocation] = useState('');
  const [conditions, setConditions] = useState('');
  const [intervalDays, setIntervalDays] = useState('180');
  const [lastServiced, setLastServiced] = useState('');
  const [nextDue, setNextDue] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Registered | null>(null);
  const [qrSvg, setQrSvg] = useState('');

  useEffect(() => {
    if (!labId && labs.length > 0) setLabId(labs[0].id);
  }, [labs, labId]);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    if (done) void renderQrSvg(passportUrl(done.qr_token)).then(setQrSvg);
  }, [done]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    const lab = labs.find((l) => l.id === labId);
    if (!lab || !profile) return setError('Choose the lab this machine belongs to.');
    if (!name.trim()) return setError('Give the machine a name.');
    const days = Number(intervalDays);
    if (!Number.isInteger(days) || days < 1) return setError('Service interval must be a whole number of days.');

    const history = planInitialHistory({
      lastServiced,
      nextDue,
      intervalDays: days,
      today: todayInLab(),
      nowIso: new Date().toISOString(),
      timezone: institution.timezone,
    });
    if (!history.ok) return setError(history.error);

    setBusy(true);
    try {
      // Next number in this lab. Two people registering at the same moment
      // could pick the same one; the unique constraint catches it and we retry.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const { data: existing, error: readError } = await supabase
          .from('equipment')
          .select('asset_id')
          .eq('lab_id', lab.id);
        if (readError) throw readError;

        const highest = (existing as { asset_id: string }[]).reduce((max, row) => {
          const n = Number(row.asset_id.split('-').pop());
          return Number.isFinite(n) && n > max ? n : max;
        }, 0);

        const row = {
          lab_id: lab.id,
          asset_id: buildAssetId(lab.code, highest + 1 + attempt),
          qr_token: generateQrToken(),
          name: name.trim(),
          manufacturer: manufacturer.trim() || null,
          model: model.trim() || null,
          serial_no: serial.trim() || null,
          location: location.trim() || null,
          operating_conditions: conditions.trim() || null,
          service_interval_days: days,
          created_by: profile.id,
        };

        const { data: inserted, error: insertError } = await supabase
          .from('equipment')
          .insert(row)
          .select('id, qr_token, lab_id, asset_id, name, manufacturer, model, serial_no, location, operating_conditions, photo_path, status, last_service_at, next_service_due')
          .single();

        if (insertError?.code === '23505') continue; // taken a moment ago; try the next number
        if (insertError) throw insertError;

        const saved = inserted as typeof row & {
          id: string;
          photo_path: string | null;
          status: 'operational';
          last_service_at: string | null;
          next_service_due: string | null;
        };
        await db.equipment.put({ ...saved, cached_at: Date.now() });

        // The service history it arrived with, as ordinary events through the
        // outbox: if this request drops after the machine was created, the
        // history still reaches the server, and the trigger works out the
        // due date exactly as it does for every later service.
        for (const planned of history.events) {
          await enqueueEvent({
            id: crypto.randomUUID(),
            equipment_id: saved.id,
            type: planned.type,
            occurred_at: planned.occurred_at,
            data: planned.data,
            severity: null,
            ...(planned.next_due_date ? { next_due_date: planned.next_due_date } : {}),
            recorded_by: profile.id,
            synced: false,
          });
        }
        if (photo) await queueEquipmentPhoto(saved.id, photo);
        if (photo || history.events.length > 0) void sync().catch(() => undefined);
        void queryClient.invalidateQueries({ queryKey: ['my-equipment'] });
        setDone({
          qr_token: saved.qr_token,
          asset_id: saved.asset_id,
          name: saved.name,
          labName: lab.name,
          firstDue: history.firstDue,
        });
        return;
      }
      throw new Error('Could not assign an asset ID. Try again.');
    } catch (err) {
      setError(
        state === 'offline'
          ? 'Registering needs a connection to the server. Try again on the campus network.'
          : err instanceof Error
            ? err.message
            : 'That machine could not be registered.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Container width="reading" className="py-8">
        <p className="m-0 flex items-center gap-2 text-[15px] font-semibold text-brand print:hidden">
          <Icon name="check_circle" filled />
          Registered. Print the label and stick it on the machine.
        </p>
        <p
          className={`mb-0 mt-2 flex items-start gap-2 text-[14px] leading-5 print:hidden ${
            done.firstDue ? 'text-ink' : 'text-attention-ink'
          }`}
        >
          <Icon name={done.firstDue ? 'event' : 'event_busy'} size={18} className="shrink-0" />
          {done.firstDue
            ? `First service due ${formatDate(done.firstDue)}. Alerts start 30 days before.`
            : 'No service date recorded, so this machine will not alert until its first service is logged.'}
        </p>

        <div className="mt-6 rounded-xl border-4 border-accent bg-surface-raised p-6 text-center">
          {/* The QR svg is generated locally by the qrcode library from our own URL. */}
          <div className="mx-auto w-[220px] max-w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          <p className="mono mb-0 mt-3 text-[19px] font-semibold tracking-[0.02em] text-ink-strong">{done.asset_id}</p>
          <p className="mb-0 mt-1 text-[15px] text-ink">{done.name}</p>
          <p className="mb-0 mt-1 text-[13px] text-ink-muted">{done.labName} · Scan for status and history</p>
          <p className="mono mb-0 mt-2 text-[13px] text-ink-muted">Code {done.qr_token}</p>
        </div>

        <div className="mt-6 flex flex-col gap-3 print:hidden sm:flex-row">
          <Button intent="scan" icon="print" block onClick={() => window.print()}>
            Print label
          </Button>
          <Button intent="secondary" icon="badge" block onClick={() => navigate(`/e/${done.qr_token}`)}>
            Open passport
          </Button>
        </div>
        <Button
          intent="ghost"
          icon="add"
          className="mt-3 print:hidden"
          onClick={() => {
            setDone(null);
            setQrSvg('');
            setName('');
            setManufacturer('');
            setModel('');
            setSerial('');
            setLocation('');
            setConditions('');
            setLastServiced('');
            setNextDue('');
            setPhoto(null);
          }}
        >
          Register another
        </Button>
      </Container>
    );
  }

  return (
    <Container width="reading" className="py-8">
      <h1 className="m-0 text-[28px] font-bold leading-8 tracking-[-0.015em] text-ink-strong">Register equipment</h1>
      <p className="mb-0 mt-2 text-[15px] leading-[23px] text-ink-muted">
        The asset ID and QR code are assigned when you save. The code is permanent: the label is printed once.
      </p>

      {labs.length === 0 && profile ? (
        <p className="mt-6 rounded-lg bg-attention-tint p-4 text-[14px] text-attention-ink">
          Your account is not a member of any lab yet, so you cannot register equipment. Ask the administrator to add you
          to a lab.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
        <Field label="Lab" required>
          {(control) => (
            <select
              {...control}
              value={labId}
              onChange={(e) => setLabId(e.target.value)}
              className={`min-h-touch ${controlClass()}`}
            >
              {labs.map((lab) => (
                <option key={lab.id} value={lab.id}>
                  {lab.name} ({lab.code})
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} help="What people call it, e.g. UV-Vis Spectrophotometer" />

        <div className="grid grid-cols-1 [&>*]:min-w-0 gap-5 sm:grid-cols-2">
          <Field label="Manufacturer" value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />
          <Field label="Model" mono value={model} onChange={(e) => setModel(e.target.value)} />
          <Field label="Serial number" mono value={serial} onChange={(e) => setSerial(e.target.value)} />
          <Field label="Location in the lab" value={location} onChange={(e) => setLocation(e.target.value)} help="e.g. Bench 3" />
        </div>

        <Field label="Safe operating conditions" help="Shown to everyone who scans the label.">
          {(control) => (
            <textarea
              {...control}
              rows={3}
              value={conditions}
              onChange={(e) => setConditions(e.target.value)}
              className={controlClass()}
            />
          )}
        </Field>

        <Field
          label="Service interval (days)"
          type="number"
          inputMode="numeric"
          min={1}
          value={intervalDays}
          onChange={(e) => setIntervalDays(e.target.value)}
          help="Used to work out the next due date after each service."
        />

        <fieldset className="m-0 flex flex-col gap-5 rounded-lg border border-line-subtle p-4">
          <legend className="px-1 text-[14px] font-semibold leading-[18px] text-ink-strong">Service history so far</legend>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 [&>*]:min-w-0">
            <Field
              label="Last serviced"
              type="date"
              max={todayInLab()}
              value={lastServiced}
              onChange={(e) => setLastServiced(e.target.value)}
              help="From the service sticker or the logbook."
            />
            <Field
              label="Next service due"
              type="date"
              value={nextDue}
              onChange={(e) => setNextDue(e.target.value)}
              help="Only if an engineer set a date. Otherwise it is worked out."
            />
          </div>
          <DuePreview lastServiced={lastServiced} nextDue={nextDue} intervalDays={intervalDays} />
        </fieldset>

        <div>
          <span className="mb-2 block text-[14px] font-semibold leading-[18px] text-ink-strong">Photo</span>
          {photoPreview ? (
            <img src={photoPreview} alt="" className="mb-3 block aspect-[4/3] max-h-[260px] w-full rounded-lg object-cover" />
          ) : null}
          <PhotoSource
            onFiles={([file]) => setPhoto(file ?? null)}
            takeLabel={photo ? 'Retake' : 'Take photo'}
            takeIntent="secondary"
          />
          <span className="mt-2 block text-[13px] leading-[19px] text-ink-muted">
            Optional. You can also add or change it later from the machine&rsquo;s passport.
          </span>
        </div>

        {error ? (
          <p role="alert" className="m-0 flex items-start gap-2 text-[14px] font-medium text-urgent-ink">
            <Icon name="error" filled size={18} />
            {error}
          </p>
        ) : null}

        <div className="flex gap-3">
          <Button intent="secondary" onClick={() => navigate('/staff')}>
            Cancel
          </Button>
          <Button type="submit" intent="primary" icon="qr_code_2" block disabled={busy || labs.length === 0}>
            {busy ? 'Registering…' : 'Register and make label'}
          </Button>
        </div>
      </form>
    </Container>
  );
}

/**
 * Says, before saving, what the first due date will be — or that there will
 * not be one. A machine with no date never alerts, and that should never be
 * a surprise found months later.
 */
function DuePreview({ lastServiced, nextDue, intervalDays }: { lastServiced: string; nextDue: string; intervalDays: string }) {
  const days = Number(intervalDays);
  const plan = planInitialHistory({
    lastServiced,
    nextDue,
    intervalDays: Number.isInteger(days) && days > 0 ? days : 0,
    today: todayInLab(),
    nowIso: new Date().toISOString(),
    timezone: institution.timezone,
  });

  if (!plan.ok) {
    return (
      <p className="m-0 flex items-start gap-2 text-[14px] leading-5 text-urgent-ink">
        <Icon name="error" filled size={18} className="shrink-0" />
        {plan.error}
      </p>
    );
  }
  if (!plan.firstDue) {
    return (
      <p className="m-0 flex items-start gap-2 rounded-md bg-attention-tint p-3 text-[14px] leading-5 text-attention-ink">
        <Icon name="warning" size={18} className="shrink-0" />
        Without either date this machine has no due date, so it will not alert until its first service is recorded.
      </p>
    );
  }
  return (
    <p className="m-0 flex items-start gap-2 text-[14px] leading-5 text-ink">
      <Icon name="event" size={18} className="shrink-0 text-ink-muted" />
      First service due <strong className="mono font-medium">{formatDate(plan.firstDue)}</strong>
    </p>
  );
}
