import { formatDate, formatDateTime } from '@/lib/dates';
import { institution } from '@/lib/institution';
import { EVENT_LABEL, STATUS, STATUSES } from '@/lib/status';
import type { EventRowOut, MachineRow } from './data';

/**
 * Word reports with the institution header: one machine's passport and
 * history, or one lab's summary. The docx library is loaded on demand.
 */

async function lib() {
  return import('docx');
}

type Docx = Awaited<ReturnType<typeof lib>>;

function header(x: Docx, title: string, subtitle: string) {
  return [
    new x.Paragraph({
      children: [new x.TextRun({ text: institution.name, bold: true, size: 28 })],
    }),
    new x.Paragraph({
      children: [new x.TextRun({ text: institution.productName, size: 20, color: '5A6459' })],
      spacing: { after: 240 },
    }),
    new x.Paragraph({ text: title, heading: x.HeadingLevel.HEADING_1 }),
    new x.Paragraph({
      children: [new x.TextRun({ text: subtitle, color: '5A6459' })],
      spacing: { after: 240 },
    }),
  ];
}

function table(x: Docx, headers: string[], rows: string[][]) {
  const cell = (text: string, bold = false) =>
    new x.TableCell({
      children: [new x.Paragraph({ children: [new x.TextRun({ text, bold, size: 18 })] })],
      margins: { top: 60, bottom: 60, left: 80, right: 80 },
    });
  return new x.Table({
    width: { size: 100, type: x.WidthType.PERCENTAGE },
    rows: [
      new x.TableRow({ tableHeader: true, children: headers.map((h) => cell(h, true)) }),
      ...rows.map((r) => new x.TableRow({ children: r.map((c) => cell(c)) })),
    ],
  });
}

function keyValues(x: Docx, pairs: [string, string][]) {
  return table(
    x,
    ['Field', 'Value'],
    pairs.filter(([, v]) => v).map(([k, v]) => [k, v]),
  );
}

async function pack(x: Docx, children: (InstanceType<Docx['Paragraph']> | InstanceType<Docx['Table']>)[]) {
  const doc = new x.Document({
    creator: institution.productName,
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{ children }],
  });
  return x.Packer.toBlob(doc);
}

const d = (v: string | null) => (v ? formatDate(v) : '');

export async function wordEquipmentReport(machine: MachineRow, history: EventRowOut[]): Promise<Blob> {
  const x = await lib();
  return pack(x, [
    ...header(x, `Equipment report: ${machine.name}`, `${machine.asset_id} · generated ${formatDate(new Date().toISOString())}`),
    keyValues(x, [
      ['Asset ID', machine.asset_id],
      ['Name', machine.name],
      ['Laboratory', machine.lab_name],
      ['Location', machine.location ?? ''],
      ['Manufacturer', machine.manufacturer ?? ''],
      ['Model', machine.model ?? ''],
      ['Serial number', machine.serial_no ?? ''],
      ['Status', STATUS[machine.status]?.label ?? machine.status],
      ['Last serviced', d(machine.last_service_at)],
      ['Next service due', d(machine.next_service_due)],
      ['Safe operating conditions', machine.operating_conditions ?? ''],
    ]),
    new x.Paragraph({ text: 'History', heading: x.HeadingLevel.HEADING_2, spacing: { before: 360, after: 120 } }),
    history.length
      ? table(
          x,
          ['Date', 'Event', 'Summary', 'Recorded by'],
          history.map((e) => [
            formatDateTime(e.occurred_at),
            `${EVENT_LABEL[e.type as keyof typeof EVENT_LABEL] ?? e.type}${e.severity ? ` (${e.severity})` : ''}`,
            e.summary,
            e.recorded_by,
          ]),
        )
      : new x.Paragraph({ text: 'No events recorded in this period.' }),
  ]);
}

export async function wordLabSummary(scope: string, machines: MachineRow[], faults: EventRowOut[]): Promise<Blob> {
  const x = await lib();
  const counts = STATUSES.map((s) => [STATUS[s].label, String(machines.filter((m) => m.status === s).length)]);
  const attention = machines
    .filter((m) => ['faulty', 'overdue', 'replace', 'due_soon'].includes(m.status))
    .sort((a, b) => STATUS[b.status].rank - STATUS[a.status].rank);

  return pack(x, [
    ...header(x, `Lab summary: ${scope}`, `${machines.length} machines · generated ${formatDate(new Date().toISOString())}`),
    new x.Paragraph({ text: 'Status overview', heading: x.HeadingLevel.HEADING_2, spacing: { after: 120 } }),
    table(x, ['Status', 'Machines'], counts),
    new x.Paragraph({ text: 'Needs attention', heading: x.HeadingLevel.HEADING_2, spacing: { before: 360, after: 120 } }),
    attention.length
      ? table(
          x,
          ['Asset ID', 'Equipment', 'Laboratory', 'Status', 'Next service due'],
          attention.map((m) => [m.asset_id, m.name, m.lab_name, STATUS[m.status].label, d(m.next_service_due)]),
        )
      : new x.Paragraph({ text: 'Nothing faulty, overdue, due soon or awaiting replacement.' }),
    new x.Paragraph({ text: 'Faults in this period', heading: x.HeadingLevel.HEADING_2, spacing: { before: 360, after: 120 } }),
    faults.length
      ? table(
          x,
          ['Date', 'Asset ID', 'Severity', 'Description'],
          faults.map((f) => [formatDate(f.occurred_at), f.asset_id, f.severity ?? '', f.summary]),
        )
      : new x.Paragraph({ text: 'No faults reported in this period.' }),
    new x.Paragraph({ text: 'Equipment register', heading: x.HeadingLevel.HEADING_2, spacing: { before: 360, after: 120 } }),
    table(
      x,
      ['Asset ID', 'Equipment', 'Location', 'Status', 'Next due'],
      machines.map((m) => [m.asset_id, m.name, m.location ?? '', STATUS[m.status].label, d(m.next_service_due)]),
    ),
  ]);
}
