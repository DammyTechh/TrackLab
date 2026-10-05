import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { Container } from '@/ui/Container';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { useAuth } from '@/app/AuthProvider';
import { download, loadEvents, loadMachines } from './data';
import { exportFaults, exportHistory, exportRegister, exportSchedule } from './exportExcel';
import { wordEquipmentReport, wordLabSummary } from './exportWord';

interface LabOption {
  id: string;
  name: string;
  code: string;
}

type JobKey = 'register' | 'schedule' | 'faults' | 'history' | 'equipment' | 'summary';

/**
 * Excel and Word exports, built in the browser. Technicians and HODs export
 * their own labs; senior leaders export any lab or all of them. The scope is
 * enforced by RLS, so the lab list here only offers what the server will return.
 */
export function ReportsPage() {
  const { profile } = useAuth();
  const [labId, setLabId] = useState<string>('all');
  const [from, setFrom] = useState(() => format(subDays(new Date(), 90), 'yyyy-MM-dd'));
  const [to, setTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [machineId, setMachineId] = useState('');
  const [busy, setBusy] = useState<JobKey | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'cache'; text: string } | null>(null);

  const labs = useQuery({
    queryKey: ['report-labs', profile?.role, profile?.lab_ids],
    enabled: Boolean(profile),
    queryFn: async () => {
      let query = supabase.from('labs').select('id, name, code').order('name');
      if (profile?.role !== 'senior_leader') query = query.in('id', profile?.lab_ids ?? []);
      const { data, error } = await query;
      if (error) throw error;
      return data as LabOption[];
    },
  });

  const machines = useQuery({
    queryKey: ['report-machines', labId],
    queryFn: () => loadMachines(labId),
  });

  const scope = labId === 'all' ? (profile?.role === 'senior_leader' ? 'All labs' : 'My labs') : labs.data?.find((l) => l.id === labId)?.name ?? '';
  const range = `${from} to ${to}`;
  const stamp = format(new Date(), 'yyyy-MM-dd');
  const slug = scope.replace(/\s+/g, '-');

  async function run(key: JobKey) {
    setBusy(key);
    setMessage(null);
    try {
      const { rows, fromCache } = machines.data ?? (await loadMachines(labId));
      switch (key) {
        case 'register':
          download(await exportRegister(rows, scope), `Equipment-register_${slug}_${stamp}.xlsx`);
          break;
        case 'schedule':
          download(await exportSchedule(rows, scope), `Service-schedule_${slug}_${stamp}.xlsx`);
          break;
        case 'faults':
          download(
            await exportFaults(await loadEvents(labId, from, to, { type: 'fault' }), `${scope}, ${range}`),
            `Fault-log_${slug}_${from}_${to}.xlsx`,
          );
          break;
        case 'history':
          download(
            await exportHistory(await loadEvents(labId, from, to), `${scope}, ${range}`),
            `Event-history_${slug}_${from}_${to}.xlsx`,
          );
          break;
        case 'equipment': {
          const machine = rows.find((m) => m.id === machineId);
          if (!machine) throw new Error('Choose a machine first.');
          const history = await loadEvents('all', '2000-01-01', to, { equipmentId: machine.id });
          download(await wordEquipmentReport(machine, history), `Equipment-report_${machine.asset_id}_${stamp}.docx`);
          break;
        }
        case 'summary':
          download(
            await wordLabSummary(scope, rows, await loadEvents(labId, from, to, { type: 'fault' })),
            `Lab-summary_${slug}_${stamp}.docx`,
          );
          break;
      }
      setMessage(
        fromCache && (key === 'register' || key === 'schedule')
          ? { tone: 'cache', text: 'No connection, so this was built from the copy saved on this device.' }
          : { tone: 'ok', text: 'Downloaded.' },
      );
    } catch (err) {
      setMessage({
        tone: 'error',
        text:
          err instanceof Error && err.message === 'Choose a machine first.'
            ? err.message
            : 'This report needs a connection to the server. Equipment register and service schedule work offline.',
      });
    } finally {
      setBusy(null);
    }
  }

  const machineRows = machines.data?.rows ?? [];

  return (
    <Container width="app" className="py-6 sm:py-8">
      <h1 className="m-0 text-[28px] font-bold leading-8 tracking-[-0.015em] text-ink-strong">Reports</h1>
      <p className="mb-0 mt-2 text-[15px] text-ink-muted">Excel and Word files, generated on this device.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 rounded-lg border border-line-subtle bg-surface-raised p-4 sm:grid-cols-3 [&>*]:min-w-0">
        <label className="flex flex-col gap-2 text-[14px] font-semibold text-ink-strong">
          Lab
          <select
            value={labId}
            onChange={(e) => setLabId(e.target.value)}
            className="min-h-touch rounded-md border border-line-strong bg-surface-raised px-3 font-normal"
          >
            <option value="all">{profile?.role === 'senior_leader' ? 'All labs' : 'All my labs'}</option>
            {(labs.data ?? []).map((lab) => (
              <option key={lab.id} value={lab.id}>
                {lab.name} ({lab.code})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-[14px] font-semibold text-ink-strong">
          From
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-touch rounded-md border border-line-strong bg-surface-raised px-3 font-normal"
          />
        </label>
        <label className="flex flex-col gap-2 text-[14px] font-semibold text-ink-strong">
          To
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="min-h-touch rounded-md border border-line-strong bg-surface-raised px-3 font-normal"
          />
        </label>
        <p className="m-0 text-[13px] text-ink-muted sm:col-span-3">
          The date range applies to the fault log, event history and the faults section of the lab summary.
        </p>
      </div>

      {message ? (
        <p
          role="status"
          className={[
            'mb-0 mt-4 flex items-start gap-2 rounded-lg p-3 text-[14px]',
            message.tone === 'error'
              ? 'bg-urgent-tint text-urgent-ink'
              : message.tone === 'cache'
                ? 'bg-attention-tint text-attention-ink'
                : 'bg-brand-surface text-brand',
          ].join(' ')}
        >
          <Icon name={message.tone === 'error' ? 'error' : message.tone === 'cache' ? 'cloud_off' : 'download_done'} size={18} />
          {message.text}
        </p>
      ) : null}

      <h2 className="mb-3 mt-8 text-[19px] font-semibold text-ink-strong">Excel</h2>
      <div className="grid grid-cols-1 [&>*]:min-w-0 gap-3 sm:grid-cols-2">
        <ReportCard
          icon="table_view"
          title="Equipment register"
          body="Every machine with make, model, serial number, status and service dates."
          busy={busy === 'register'}
          onRun={() => run('register')}
          offline
        />
        <ReportCard
          icon="event_upcoming"
          title="Service schedule"
          body="Machines in due-date order with days remaining. Overdue ones show negative days."
          busy={busy === 'schedule'}
          onRun={() => run('schedule')}
          offline
        />
        <ReportCard
          icon="report"
          title="Fault log"
          body="Every fault reported in the date range, with severity and who reported it."
          busy={busy === 'faults'}
          onRun={() => run('faults')}
        />
        <ReportCard
          icon="history"
          title="Event history"
          body="All uses, faults, maintenance, inspections and service reports in the date range."
          busy={busy === 'history'}
          onRun={() => run('history')}
        />
      </div>

      <h2 className="mb-3 mt-8 text-[19px] font-semibold text-ink-strong">Word</h2>
      <div className="grid grid-cols-1 [&>*]:min-w-0 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface-raised p-4">
          <p className="m-0 flex items-center gap-2 text-[16px] font-semibold text-ink-strong">
            <Icon name="description" className="text-brand" />
            Equipment report
          </p>
          <p className="m-0 text-[14px] leading-5 text-ink-muted">One machine&rsquo;s passport and its full history.</p>
          <label htmlFor="report-machine" className="sr-only">
            Machine
          </label>
          <select
            id="report-machine"
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            className="min-h-touch w-full rounded-md border border-line-strong bg-surface-raised px-3 text-[15px]"
          >
            <option value="">Choose a machine…</option>
            {machineRows.map((m) => (
              <option key={m.id} value={m.id}>
                {m.asset_id} · {m.name}
              </option>
            ))}
          </select>
          <Button intent="primary" icon="download" disabled={!machineId || busy !== null} onClick={() => run('equipment')}>
            {busy === 'equipment' ? 'Preparing…' : 'Download .docx'}
          </Button>
        </div>
        <ReportCard
          icon="summarize"
          title="Lab summary"
          body="Status counts, what needs attention, faults in the date range and the full register, with the institution header."
          busy={busy === 'summary'}
          onRun={() => run('summary')}
          docx
        />
      </div>
    </Container>
  );
}

function ReportCard({
  icon,
  title,
  body,
  busy,
  onRun,
  offline,
  docx,
}: {
  icon: string;
  title: string;
  body: string;
  busy: boolean;
  onRun: () => void;
  offline?: boolean;
  docx?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-surface-raised p-4">
      <p className="m-0 flex items-center gap-2 text-[16px] font-semibold text-ink-strong">
        <Icon name={icon} className="text-brand" />
        {title}
      </p>
      <p className="m-0 flex-1 text-[14px] leading-5 text-ink-muted">{body}</p>
      {offline ? <p className="m-0 text-[13px] text-calm-ink">Works offline from this device&rsquo;s copy.</p> : null}
      <Button intent="secondary" icon="download" disabled={busy} onClick={onRun}>
        {busy ? 'Preparing…' : docx ? 'Download .docx' : 'Download .xlsx'}
      </Button>
    </div>
  );
}
