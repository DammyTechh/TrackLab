import { useMutation, useQueryClient } from '@tanstack/react-query';
import imageCompression from 'browser-image-compression';
import { enqueue, enqueueEvent } from '@/offline/outbox';
import { syncInBackground } from '@/offline/sync';
import { useAuth } from '@/app/AuthProvider';
import type { EventInput } from './schemas';

/**
 * Saving never waits for a network.
 *
 * The event id is generated on the device, so an offline create can never
 * collide with another technician's and a retry can never double insert. The
 * row goes into the local history immediately marked unsynced, and the
 * interface shows it as saved — because on this phone it is.
 */

const compress = (file: File) =>
  imageCompression(file, { maxSizeMB: 0.6, maxWidthOrHeight: 1600, useWebWorker: true, fileType: 'image/jpeg' });

/** Where a service report's file goes. The form calls this so the path can be validated before saving. */
export function reportPath(equipmentId: string, eventId: string, file: File): string {
  const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg';
  return `${equipmentId}/${eventId}/report-${crypto.randomUUID()}.${ext}`;
}

export function useRecordEvent(equipmentId: string) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  return useMutation({
    mutationFn: async ({
      id = crypto.randomUUID(),
      input,
      photos,
      reportFile,
    }: {
      id?: string;
      input: EventInput;
      photos?: File[];
      /** The engineer's signed report, PDF or photo. Its path is already in input.report.report_path. */
      reportFile?: File;
    }) => {
      if (!profile) throw new Error('Not signed in.');

      const files = await Promise.all(
        (photos ?? []).map(async (photo) => ({
          field: 'photo',
          bucket: 'event-files',
          path: `${equipmentId}/${id}/${crypto.randomUUID()}.jpg`,
          // Compress before it ever touches the queue: a 6 MB phone photo
          // will not upload over a campus link, and will fill IndexedDB.
          blob: await compress(photo),
        })),
      );

      if (reportFile && 'report' in input) {
        files.push({
          field: 'report',
          bucket: 'event-files',
          path: input.report.report_path,
          blob: reportFile.type === 'application/pdf' ? reportFile : await compress(reportFile),
        });
      }

      await enqueueEvent(
        {
          id,
          equipment_id: equipmentId,
          type: input.type,
          occurred_at: input.occurred_at,
          data: input.data as Record<string, unknown>,
          severity: 'severity' in input ? input.severity : null,
          ...('next_due_date' in input && input.next_due_date ? { next_due_date: input.next_due_date } : {}),
          recorded_by: profile.id,
          synced: false,
        },
        files,
      );

      if ('report' in input && input.report) {
        // Queued after the event, so it lands after the event row it points at.
        await enqueue('service_report', crypto.randomUUID(), {
          event_id: id,
          ...input.report,
          next_due_date: input.next_due_date ?? null,
        });
      }

      syncInBackground();
      return id;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['passport'] });
      void queryClient.invalidateQueries({ queryKey: ['my-equipment'] });
    },
  });
}
