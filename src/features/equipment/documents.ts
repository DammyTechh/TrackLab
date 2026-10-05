import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import imageCompression from 'browser-image-compression';
import { supabase, DOCUMENTS_BUCKET } from '@/lib/supabase';
import { db } from '@/offline/db';
import { enqueue } from '@/offline/outbox';
import { sync } from '@/offline/sync';

/**
 * SOPs, manuals and certificates attached to a machine.
 *
 * Same contract as photos and events: adding one never waits for a network.
 * The file is queued in the outbox with its row, shown on this device at
 * once, and uploaded by the normal sync (files first, then the row, so a row
 * never points at a file that is not there).
 *
 * Documents are never edited or deleted. A wrong SOP is withdrawn and a new
 * one uploaded; the database refuses anything else (0009).
 */

export type DocumentKind = 'sop' | 'manual' | 'certificate';

export const DOCUMENT_KINDS: { value: DocumentKind; label: string; hint: string }[] = [
  { value: 'sop', label: 'SOP', hint: 'Shown to everyone who scans the label' },
  { value: 'manual', label: 'Manual', hint: 'Staff only' },
  { value: 'certificate', label: 'Certificate', hint: 'Staff only, e.g. calibration' },
];

/** Must match allowed_mime_types on the documents bucket in 0007_storage.sql. */
const ACCEPTED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export const DOCUMENT_ACCEPT = Object.keys(ACCEPTED).join(',');

/** The bucket's own limit, in 0007. */
const MAX_BYTES = 20 * 1024 * 1024;

export interface EquipmentDocument {
  id: string;
  kind: DocumentKind;
  title: string;
  file_path: string;
  created_at: string;
  /** Still in this device's outbox. */
  pending: boolean;
  lastError?: string;
}

/** Checked before anything is queued, so the error is shown while the person is still holding the phone. */
export function validateDocument(file: File, title: string): string | null {
  if (!title.trim()) return 'Give the document a title, e.g. "Start-up and shutdown".';
  if (!ACCEPTED[file.type]) return 'Use a PDF, a Word document, or a photo (JPEG or PNG).';
  if (file.size > MAX_BYTES) return 'That file is over 20 MB. Scan it at a lower resolution or split it.';
  return null;
}

/**
 * A photographed page is the usual way an SOP arrives from a bench. Shrink it
 * the way photos are shrunk, but keep enough resolution to read small print.
 */
async function prepare(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  return imageCompression(file, {
    maxSizeMB: 1.5,
    maxWidthOrHeight: 2400,
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: 0.88,
  });
}

export async function queueDocument(
  equipmentId: string,
  file: File,
  { title, kind }: { title: string; kind: DocumentKind },
): Promise<string> {
  const problem = validateDocument(file, title);
  if (problem) throw new Error(problem);

  const blob = await prepare(file);
  const id = crypto.randomUUID();
  const extension = blob.type === 'image/jpeg' ? 'jpg' : ACCEPTED[file.type]!;
  const path = `${equipmentId}/${id}.${extension}`;

  await enqueue(
    'document',
    id,
    // No uploaded_by: the database fills it from the session (0009) and
    // refuses any other value.
    { id, equipment_id: equipmentId, kind, title: title.trim(), file_path: path },
    [{ field: 'document', bucket: DOCUMENTS_BUCKET, path, blob }],
  );
  return id;
}

/** Every live document on a machine, plus any still waiting on this device. Staff only (RLS). */
export function useEquipmentDocuments(equipmentId: string | undefined) {
  const queryClient = useQueryClient();

  const server = useQuery({
    queryKey: ['documents', equipmentId],
    enabled: Boolean(equipmentId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('equipment_documents')
        .select('id, kind, title, file_path, created_at')
        .eq('equipment_id', equipmentId!)
        .is('withdrawn_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Omit<EquipmentDocument, 'pending'>[];
    },
  });

  const queued = useLiveQuery(
    () =>
      equipmentId
        ? db.outbox
            .where('kind')
            .equals('document')
            .filter((item) => item.payload.equipment_id === equipmentId)
            .toArray()
        : [],
    [equipmentId],
    [],
  );

  // When an item leaves the outbox it has reached the server; refetch so the
  // server copy replaces the pending one without a gap.
  const queuedCount = queued.length;
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ['documents', equipmentId] });
  }, [queuedCount, equipmentId, queryClient]);

  const onServer = new Set((server.data ?? []).map((d) => d.id));
  const pending: EquipmentDocument[] = queued
    .filter((item) => !onServer.has(item.id))
    .map((item) => ({
      id: item.id,
      kind: item.payload.kind as DocumentKind,
      title: item.payload.title as string,
      file_path: item.payload.file_path as string,
      created_at: new Date(item.created_at).toISOString(),
      pending: true,
      lastError: item.attempts > 0 ? item.last_error : undefined,
    }));

  return {
    documents: [...pending, ...(server.data ?? []).map((d) => ({ ...d, pending: false }))],
    isLoading: server.isLoading,
    isError: server.isError,
  };
}

export function useAddDocument(equipmentId: string | undefined) {
  return useMutation({
    mutationFn: async (input: { file: File; title: string; kind: DocumentKind }) => {
      if (!equipmentId) throw new Error('This machine is not loaded yet. Try again in a moment.');
      const id = await queueDocument(equipmentId, input.file, input);
      void sync().catch(() => undefined);
      return id;
    },
  });
}

/**
 * Withdrawing needs the server: it changes what every visitor sees, so it
 * must happen once, in one place, rather than sit in one phone's queue.
 */
export function useWithdrawDocument(equipmentId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: string) => {
      const { data, error } = await supabase
        .from('equipment_documents')
        .update({ withdrawn_at: new Date().toISOString() })
        .eq('id', documentId)
        .select('id');
      if (error) throw error;
      if (!data || data.length === 0) throw new Error('You cannot withdraw documents on this machine.');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['documents', equipmentId] });
      void queryClient.invalidateQueries({ queryKey: ['passport'] });
    },
  });
}

/**
 * Open a document in a new tab. The bucket is private, so this signs a
 * short-lived URL; a visitor can sign only the SOPs a passport lists
 * (is_public_sop in 0007/0009), staff can sign anything in their labs.
 *
 * The tab is opened BEFORE the await. Safari, and Chrome on Android, treat a
 * window.open after an await as an unrequested popup and silently block it.
 */
export async function openDocument(path: string): Promise<void> {
  const tab = window.open('', '_blank');
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 300);

  if (error || !data) {
    tab?.close();
    throw new Error('That document could not be opened. Check your connection and try again.');
  }
  if (tab) {
    tab.opener = null;
    tab.location.href = data.signedUrl;
  } else window.location.assign(data.signedUrl);
}
