import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/Button';
import { Field, controlClass, type ControlProps } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Container, StickyActions } from '@/ui/Container';
import { PhotoSource } from '@/ui/PhotoSource';
import { useNetwork } from '@/app/NetworkProvider';
import { useAuth } from '@/app/AuthProvider';
import { db } from '@/offline/db';
import { reportPath, useRecordEvent } from './useRecordEvent';
import {
  EVENT_TYPES,
  faultSchema,
  inspectionSchema,
  maintenanceSchema,
  serviceReportSchema,
  useSchema,
  type EventInput,
  type EventTypeKey,
} from './schemas';

/** Heading and save verb per event type. */
const FORM_COPY: Record<EventTypeKey, { heading: string; save: string; icon: string }> = {
  use: { heading: 'Log use', save: 'Save use log', icon: 'play_circle' },
  fault: { heading: 'Report fault', save: 'Save fault report', icon: 'report' },
  maintenance: { heading: 'Record maintenance', save: 'Save maintenance record', icon: 'build' },
  inspection: { heading: 'Record inspection', save: 'Save inspection', icon: 'fact_check' },
  service_report: { heading: 'External service report', save: 'Save service report', icon: 'engineering' },
};

const SCHEMA = {
  use: useSchema,
  fault: faultSchema,
  maintenance: maintenanceSchema,
  inspection: inspectionSchema,
  service_report: serviceReportSchema,
} as const;

type Errors = Record<string, string>;

const nowLocal = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");

/**
 * One screen, five event types. Every one saves to the device first and syncs
 * later, so a technician in a basement with no signal loses nothing. The
 * server recomputes status and due dates when each event lands; this form
 * never sets them.
 */
export function EventFormPage() {
  const params = useParams<{ id: string; type: string }>();
  const equipmentId = params.id ?? '';
  const type: EventTypeKey = (EVENT_TYPES as readonly string[]).includes(params.type ?? '')
    ? (params.type as EventTypeKey)
    : 'fault';
  const copy = FORM_COPY[type];
  const navigate = useNavigate();
  const { state } = useNetwork();
  const { profile } = useAuth();
  const record = useRecordEvent(equipmentId);
  const eventId = useMemo(() => crypto.randomUUID(), []);

  const { data: machine } = useQuery({
    queryKey: ['equipment-header', equipmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from('equipment')
        .select('name, asset_id, qr_token')
        .eq('id', equipmentId)
        .maybeSingle();
      if (data) return data as { name: string; asset_id: string; qr_token: string };
      const cached = await db.equipment.get(equipmentId);
      return cached ? { name: cached.name, asset_id: cached.asset_id, qr_token: cached.qr_token } : null;
    },
  });

  // One flat set of fields; each type reads the ones it needs.
  const [when, setWhen] = useState(nowLocal);
  const [summary, setSummary] = useState('');
  const [observations, setObservations] = useState('');
  const [severity, setSeverity] = useState<'minor' | 'major' | 'critical'>('major');
  const [operator, setOperator] = useState(profile?.full_name ?? '');
  const [runParameters, setRunParameters] = useState('');
  const [parts, setParts] = useState('');
  const [outcome, setOutcome] = useState<'resolved' | 'in_progress'>('resolved');
  const [condition, setCondition] = useState<'ok' | 'issue_found'>('ok');
  const [nextDue, setNextDue] = useState('');
  const [vendor, setVendor] = useState('');
  const [engineer, setEngineer] = useState('');
  const [contact, setContact] = useState('');
  const [serviceDate, setServiceDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [recommendation, setRecommendation] = useState<'continue' | 'repair' | 'replace'>('continue');
  const [reportFile, setReportFile] = useState<File | null>(null);
  const [reportFilePath, setReportFilePath] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [errors, setErrors] = useState<Errors>({});

  function buildInput(): unknown {
    const occurred_at = new Date(when).toISOString();
    const base = { equipment_id: equipmentId, occurred_at };
    const opt = (v: string) => (v.trim() ? v.trim() : undefined);
    switch (type) {
      case 'use':
        return {
          ...base,
          type,
          data: { purpose: summary.trim(), run_parameters: opt(runParameters), operator: opt(operator), summary: summary.trim() },
        };
      case 'fault':
        return { ...base, type, severity, data: { summary: summary.trim(), observations: opt(observations) } };
      case 'maintenance':
        return {
          ...base,
          type,
          next_due_date: opt(nextDue),
          data: { summary: summary.trim(), parts_replaced: opt(parts), outcome, in_progress: outcome === 'in_progress' },
        };
      case 'inspection':
        return {
          ...base,
          type,
          data: { summary: summary.trim(), condition, observations: opt(observations) },
        };
      case 'service_report':
        return {
          ...base,
          occurred_at: new Date(`${serviceDate}T12:00:00`).toISOString(),
          type,
          next_due_date: opt(nextDue),
          data: { summary: `${vendor.trim()}: ${summary.trim()}`.slice(0, 1000) },
          report: {
            vendor_company: vendor.trim(),
            engineer_name: opt(engineer),
            contact: opt(contact),
            service_date: serviceDate,
            work_done: summary.trim(),
            report_path: reportFilePath,
            recommendation,
          },
        };
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = SCHEMA[type].safeParse(buildInput());
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    // The data object keeps fields the schema does not list (summary on a use log) for the public history.
    const input = { ...(parsed.data as EventInput), data: (buildInput() as { data: object }).data } as EventInput;
    await record.mutateAsync({ id: eventId, input, photos, reportFile: reportFile ?? undefined });
    if (machine) navigate(`/e/${machine.qr_token}`, { replace: true });
    else navigate(-1);
  }

  const err = (key: string) => errors[key];
  const textarea = (value: string, set: (v: string) => void, key: string, rows = 3) => {
    const render = (control: ControlProps) => (
      <textarea
        {...control}
        rows={rows}
        value={value}
        onChange={(e) => set(e.target.value)}
        className={`resize-y ${controlClass(Boolean(err(key)))}`}
      />
    );
    return render;
  };

  return (
    <Container>
      <form onSubmit={onSubmit} noValidate>
        <p className="mono m-0 pt-6 text-[13px] text-ink-muted">
          {machine ? `${machine.asset_id} · ${machine.name}` : 'Loading machine…'}
        </p>
        <h1 className="m-0 mt-1 flex items-center gap-2 text-[24px] font-semibold leading-[30px] text-ink-strong">
          <Icon name={copy.icon} size={28} className="text-brand" />
          {copy.heading}
        </h1>

        <div className="flex flex-col gap-6 pt-6">
          {type !== 'service_report' ? (
            <Field label="When" required type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          ) : null}

          {type === 'use' ? (
            <>
              <Field label="Purpose" required error={err('data.purpose')} help="What the machine was used for.">
                {textarea(summary, setSummary, 'data.purpose', 2)}
              </Field>
              <Field label="Run parameters" help="Settings, samples, duration.">
                {textarea(runParameters, setRunParameters, 'data.run_parameters', 2)}
              </Field>
              <Field label="User" value={operator} onChange={(e) => setOperator(e.target.value)} help="Who ran it." />
            </>
          ) : null}

          {type === 'fault' ? (
            <>
              <Field label="What went wrong" required error={err('data.summary')} help="One or two sentences.">
                {textarea(summary, setSummary, 'data.summary')}
              </Field>
              <Pills
                legend="Severity"
                value={severity}
                onChange={setSeverity}
                tone="urgent"
                options={[
                  ['minor', 'Minor'],
                  ['major', 'Major'],
                  ['critical', 'Critical'],
                ]}
              >
                {severity === 'critical' ? (
                  <Warn>Critical takes this machine out of service straight away and alerts the lab team.</Warn>
                ) : null}
              </Pills>
              <Field label="Observations">{textarea(observations, setObservations, 'data.observations', 2)}</Field>
            </>
          ) : null}

          {type === 'maintenance' ? (
            <>
              <Field label="Work done" required error={err('data.summary')}>
                {textarea(summary, setSummary, 'data.summary')}
              </Field>
              <Field label="Parts replaced">{textarea(parts, setParts, 'data.parts_replaced', 2)}</Field>
              <Pills
                legend="Outcome"
                value={outcome}
                onChange={setOutcome}
                options={[
                  ['resolved', 'Done, back in service'],
                  ['in_progress', 'Still in progress'],
                ]}
              >
                {outcome === 'in_progress' ? (
                  <Warn>The machine shows Under maintenance until a later record says it is done.</Warn>
                ) : null}
              </Pills>
              <Field
                label="Next service due"
                type="date"
                value={nextDue}
                onChange={(e) => setNextDue(e.target.value)}
                error={err('next_due_date')}
                help="Leave empty to use the machine's service interval."
              />
            </>
          ) : null}

          {type === 'inspection' ? (
            <>
              <Field label="What you checked" required error={err('data.summary')}>
                {textarea(summary, setSummary, 'data.summary', 2)}
              </Field>
              <Pills
                legend="Condition"
                value={condition}
                onChange={setCondition}
                options={[
                  ['ok', 'OK'],
                  ['issue_found', 'Issue found'],
                ]}
              >
                {condition === 'issue_found' ? (
                  <Warn>If the machine is unsafe to use, report a fault as well so its status changes.</Warn>
                ) : null}
              </Pills>
              <Field label="Observations">{textarea(observations, setObservations, 'data.observations', 2)}</Field>
            </>
          ) : null}

          {type === 'service_report' ? (
            <>
              <Field
                label="Company"
                required
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                error={err('report.vendor_company')}
              />
              <div className="grid grid-cols-1 [&>*]:min-w-0 gap-6 sm:grid-cols-2">
                <Field label="Engineer name" value={engineer} onChange={(e) => setEngineer(e.target.value)} />
                <Field label="Contact" value={contact} onChange={(e) => setContact(e.target.value)} help="Phone or email." />
              </div>
              <Field
                label="Service date"
                required
                type="date"
                value={serviceDate}
                onChange={(e) => setServiceDate(e.target.value)}
                error={err('report.service_date')}
              />
              <Field label="Work done and findings" required error={err('report.work_done')}>
                {textarea(summary, setSummary, 'report.work_done', 4)}
              </Field>
              <FilePick
                label="Signed report"
                required
                accept="application/pdf,image/*"
                file={reportFile}
                error={err('report.report_path')}
                help="PDF or a photo of the paper report."
                onPick={(file) => {
                  setReportFile(file);
                  setReportFilePath(file ? reportPath(equipmentId, eventId, file) : '');
                }}
              />
              <Pills
                legend="Recommendation"
                value={recommendation}
                onChange={setRecommendation}
                tone={recommendation === 'replace' ? 'urgent' : 'brand'}
                options={[
                  ['continue', 'Continue'],
                  ['repair', 'Repair'],
                  ['replace', 'Replace'],
                ]}
              >
                {recommendation === 'replace' ? (
                  <Warn>
                    The machine shows Replacement recommended and the lab team gets a critical email with this report
                    attached. Record the outcome later from the passport.
                  </Warn>
                ) : null}
              </Pills>
              <Field
                label="Next service due"
                type="date"
                value={nextDue}
                onChange={(e) => setNextDue(e.target.value)}
                error={err('next_due_date')}
                help="From the engineer's report. Updates the alert schedule."
              />
            </>
          ) : null}

          {type !== 'use' ? (
            <PhotoPick photos={photos} onChange={setPhotos} />
          ) : null}

          {state !== 'online' ? (
            <p className="m-0 flex items-start gap-3 rounded-lg border border-line-strong bg-calm-tint p-4 text-[14px] leading-5 text-calm-ink">
              <Icon name={state === 'lan' ? 'lan' : 'cloud_off'} size={28} />
              {state === 'lan'
                ? 'Campus network only. This saves now; email and push alerts go out when the internet returns.'
                : 'No network. This saves on your phone and syncs by itself later.'}
            </p>
          ) : null}

          {record.isError ? (
            <p role="alert" className="m-0 text-[14px] text-urgent-ink">
              {record.error instanceof Error ? record.error.message : 'This could not be saved.'}
            </p>
          ) : null}
        </div>

        <StickyActions>
          <Button intent="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" intent="primary" icon="save" block disabled={record.isPending}>
            {record.isPending ? 'Saving…' : copy.save}
          </Button>
        </StickyActions>
      </form>
    </Container>
  );
}

function Pills<T extends string>({
  legend,
  value,
  onChange,
  options,
  tone = 'brand',
  children,
}: {
  legend: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
  tone?: 'brand' | 'urgent';
  children?: ReactNode;
}) {
  const on = tone === 'urgent' ? 'border-urgent-ink bg-urgent-ink text-ink-ondark' : 'border-brand bg-brand text-ink-ondark';
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="mb-2 p-0 text-[14px] font-semibold leading-[18px] text-ink-strong">
        {legend} <span className="text-urgent-ink">*</span>
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            className={[
              'min-h-touch flex-1 rounded-full border px-4 text-[14px] font-semibold',
              value === key ? on : 'border-line-strong bg-surface-raised text-ink',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>
      {children}
    </fieldset>
  );
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <p className="mb-0 mt-2 flex items-start gap-1 text-[13px] leading-[19px] text-urgent-ink">
      <Icon name="error" filled size={18} className="shrink-0" />
      {children}
    </p>
  );
}

function FilePick({
  label,
  required,
  accept,
  file,
  error,
  help,
  onPick,
}: {
  label: string;
  required?: boolean;
  accept: string;
  file: File | null;
  error?: string;
  help?: string;
  onPick: (file: File | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div>
      <span className="mb-2 block text-[14px] font-semibold leading-[18px] text-ink-strong">
        {label}
        {required ? <span className="text-urgent-ink"> *</span> : null}
      </span>
      <Button intent="secondary" icon={file ? 'description' : 'upload_file'} block onClick={() => input.current?.click()}>
        {file ? file.name : 'Attach report'}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      {error ? (
        <span className="mt-2 flex items-center gap-1 text-[13px] font-medium text-urgent-ink">
          <Icon name="error" filled size={18} />
          {error}
        </span>
      ) : help ? (
        <span className="mt-2 block text-[13px] leading-[19px] text-ink-muted">{help}</span>
      ) : null}
    </div>
  );
}

function PhotoPick({ photos, onChange }: { photos: File[]; onChange: (files: File[]) => void }) {
  const [previews, setPreviews] = useState<string[]>([]);
  useEffect(() => {
    const urls = photos.map((p) => URL.createObjectURL(p));
    setPreviews(urls);
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [photos]);

  return (
    <div>
      <span className="mb-2 block text-[14px] font-semibold leading-[18px] text-ink-strong">Photos</span>
      {previews.length > 0 ? (
        <ul className="m-0 mb-3 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4">
          {previews.map((url, i) => (
            <li key={url} className="relative">
              <img src={url} alt={`Attachment ${i + 1}`} className="block aspect-square w-full rounded-md object-cover" />
              <button
                type="button"
                aria-label={`Remove photo ${i + 1}`}
                onClick={() => onChange(photos.filter((_, j) => j !== i))}
                className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-surface-raised text-ink-strong shadow-raise"
              >
                <Icon name="close" size={18} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <PhotoSource multiple takeIntent="secondary" onFiles={(files) => onChange([...photos, ...files])} />
      <span className="mt-2 block text-[13px] leading-[19px] text-ink-muted">
        Optional. Compressed on this phone before upload, so it works on a weak connection.
      </span>
    </div>
  );
}
