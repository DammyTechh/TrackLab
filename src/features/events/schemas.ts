import { z } from 'zod';

/**
 * One schema per event type, shared by the form and (as a copy under
 * supabase/functions/_shared) by the edge functions. The form never validates
 * something the server does not.
 */

const base = z.object({
  equipment_id: z.string().uuid(),
  occurred_at: z.string().datetime(),
});

export const useSchema = base.extend({
  type: z.literal('use'),
  data: z.object({
    purpose: z.string().min(3, 'Say what the machine was used for.').max(500),
    run_parameters: z.string().max(1000).optional(),
    operator: z.string().max(200).optional(),
  }),
});

export const faultSchema = base.extend({
  type: z.literal('fault'),
  severity: z.enum(['minor', 'major', 'critical']),
  data: z.object({
    summary: z.string().min(5, 'Describe what went wrong.').max(1000),
    observations: z.string().max(1000).optional(),
  }),
});

export const maintenanceSchema = base
  .extend({
    type: z.literal('maintenance'),
    next_due_date: z.string().date().optional(),
    data: z.object({
      summary: z.string().min(5, 'Say what work was done.').max(1000),
      parts_replaced: z.string().max(1000).optional(),
      outcome: z.enum(['resolved', 'in_progress']),
      in_progress: z.boolean().default(false),
    }),
  })
  .refine((v) => !v.next_due_date || v.next_due_date >= v.occurred_at.slice(0, 10), {
    path: ['next_due_date'],
    message: 'Next service date is before the service date. Pick a later date.',
  });

export const inspectionSchema = base.extend({
  type: z.literal('inspection'),
  data: z.object({
    summary: z.string().min(3, 'Record what you checked.').max(1000),
    condition: z.enum(['ok', 'issue_found']),
    observations: z.string().max(1000).optional(),
  }),
});

export const serviceReportSchema = base
  .extend({
    type: z.literal('service_report'),
    next_due_date: z.string().date().optional(),
    data: z.object({ summary: z.string().max(1000).optional() }),
    report: z.object({
      vendor_company: z.string().min(2, 'Name the company that did the work.').max(200),
      engineer_name: z.string().max(200).optional(),
      contact: z.string().max(200).optional(),
      service_date: z.string().date(),
      work_done: z.string().min(5, "Summarise the engineer's findings.").max(2000),
      report_path: z.string().min(1, 'Attach the signed report.'),
      recommendation: z.enum(['continue', 'repair', 'replace']),
    }),
  })
  .refine((v) => !v.next_due_date || v.next_due_date >= v.report.service_date, {
    path: ['next_due_date'],
    message: 'Next service date is before the service date. Pick a later date.',
  });

export type EventInput =
  | z.infer<typeof useSchema>
  | z.infer<typeof faultSchema>
  | z.infer<typeof maintenanceSchema>
  | z.infer<typeof inspectionSchema>
  | z.infer<typeof serviceReportSchema>;

export const EVENT_TYPES = ['use', 'fault', 'maintenance', 'inspection', 'service_report'] as const;
export type EventTypeKey = (typeof EVENT_TYPES)[number];
