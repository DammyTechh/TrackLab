import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addMonths, format, startOfMonth, subMonths } from 'date-fns';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/lib/supabase';
import { daysUntil } from '@/lib/dates';
import { STATUS, STATUSES, type EquipmentStatus } from '@/lib/status';
import type { EquipmentListItem } from '@/features/equipment';

/** Chart colours come from the design tokens, so dark mode and rebranding follow. */
const STATUS_FILL: Record<EquipmentStatus, string> = {
  operational: 'var(--brand)',
  due_soon: 'var(--signal-attention-ink)',
  overdue: 'var(--signal-urgent-ink)',
  faulty: 'var(--signal-urgent-tint)',
  maintenance: 'var(--signal-calm-ink)',
  replace: 'var(--accent)',
  retired: 'var(--ink-muted)',
};
const SERIES = ['var(--brand)', 'var(--accent)', 'var(--signal-calm-ink)', 'var(--signal-attention-ink)', 'var(--signal-urgent-ink)', 'var(--ink-muted)'];
const AXIS = { fontSize: 12, fill: 'var(--ink-muted)' };

/**
 * Section 4.6 of the spec: headline numbers, then status by lab, services
 * coming up, and faults over time. Everything is computed from rows RLS
 * already scoped, so an HOD's charts show only their labs.
 */
export function DashboardCharts({ items, labId }: { items: EquipmentListItem[]; labId: string }) {
  const active = items.filter((i) => i.status !== 'retired');
  const operational = active.filter((i) => i.status === 'operational').length;
  const dueIn30 = active.filter((i) => i.next_service_due && daysUntil(i.next_service_due) >= 0 && daysUntil(i.next_service_due) <= 30).length;

  const byLab = useMemo(() => {
    const map = new Map<string, Record<string, number | string>>();
    for (const item of items) {
      const name = item.lab?.code ?? 'Lab';
      const row = map.get(name) ?? { lab: name };
      row[item.status] = ((row[item.status] as number) ?? 0) + 1;
      map.set(name, row);
    }
    return [...map.values()].sort((a, b) => String(a.lab).localeCompare(String(b.lab)));
  }, [items]);

  const upcoming = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => startOfMonth(addMonths(new Date(), i)));
    return months.map((m) => {
      const key = format(m, 'yyyy-MM');
      return {
        month: format(m, 'MMM'),
        services: active.filter((i) => i.next_service_due?.startsWith(key)).length,
      };
    });
  }, [active]);

  const faults = useQuery({
    queryKey: ['dashboard-faults', labId],
    queryFn: async () => {
      const since = format(startOfMonth(subMonths(new Date(), 5)), 'yyyy-MM-dd');
      let query = supabase
        .from('events')
        .select('occurred_at, equipment:equipment!inner(lab_id, lab:labs(code))')
        .eq('type', 'fault')
        .gte('occurred_at', since);
      if (labId !== 'all') query = query.eq('equipment.lab_id', labId);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as { occurred_at: string; equipment: { lab: { code: string } | null } }[];
    },
  });

  const faultSeries = useMemo(() => {
    const labs = new Set<string>();
    const months = Array.from({ length: 6 }, (_, i) => startOfMonth(subMonths(new Date(), 5 - i)));
    const rows = months.map((m) => ({ month: format(m, 'MMM'), key: format(m, 'yyyy-MM') }) as Record<string, string | number>);
    for (const f of faults.data ?? []) {
      const code = f.equipment.lab?.code ?? 'Lab';
      labs.add(code);
      const row = rows.find((r) => f.occurred_at.startsWith(String(r.key)));
      if (row) row[code] = ((row[code] as number) ?? 0) + 1;
    }
    return { rows, labs: [...labs].sort() };
  }, [faults.data]);

  return (
    <>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Machines in use" value={String(active.length)} />
        <Kpi label="Operational" value={active.length ? `${Math.round((operational / active.length) * 100)}%` : '—'} />
        <Kpi label="Service due in 30 days" value={String(dueIn30)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <ChartCard title="Status by lab">
          <BarChart data={byLab} layout="vertical" margin={{ left: 8, right: 8 }}>
            <CartesianGrid horizontal={false} stroke="var(--line-subtle)" />
            <XAxis type="number" allowDecimals={false} tick={AXIS} />
            <YAxis type="category" dataKey="lab" tick={AXIS} width={64} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {STATUSES.filter((s) => items.some((i) => i.status === s)).map((s) => (
              <Bar key={s} dataKey={s} name={STATUS[s].label} stackId="a" fill={STATUS_FILL[s]} />
            ))}
          </BarChart>
        </ChartCard>

        <ChartCard title="Services due, next 6 months">
          <BarChart data={upcoming} margin={{ left: -16, right: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--line-subtle)" />
            <XAxis dataKey="month" tick={AXIS} />
            <YAxis allowDecimals={false} tick={AXIS} />
            <Tooltip />
            <Bar dataKey="services" name="Services due" fill="var(--brand)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Faults per lab, last 6 months">
          <BarChart data={faultSeries.rows} margin={{ left: -16, right: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--line-subtle)" />
            <XAxis dataKey="month" tick={AXIS} />
            <YAxis allowDecimals={false} tick={AXIS} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {faultSeries.labs.map((code, i) => (
              <Bar key={code} dataKey={code} stackId="f" fill={SERIES[i % SERIES.length]} />
            ))}
          </BarChart>
        </ChartCard>
      </div>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line-subtle bg-surface-raised p-4">
      <p className="m-0 text-[13px] font-semibold text-ink-muted">{label}</p>
      <p className="mb-0 mt-1 text-[28px] font-bold leading-8 text-ink-strong">{value}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <figure className="m-0 rounded-lg border border-line-subtle bg-surface-raised p-4">
      <figcaption className="mb-3 text-[15px] font-semibold text-ink-strong">{title}</figcaption>
      <div className="h-[240px]">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
