import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLiveQuery } from 'dexie-react-hooks';
import imageCompression from 'browser-image-compression';
import { supabase, EQUIPMENT_PHOTO_BUCKET } from '@/lib/supabase';
import { db, type OutboxItem } from '@/offline/db';
import { enqueue } from '@/offline/outbox';
import { sync } from '@/offline/sync';
import { useAuth } from '@/app/AuthProvider';

/**
 * The equipment profile photo.
 *
 * Same contract as an event: saving never waits for a network. The photo is
 * compressed on the phone, queued in the outbox with the blob, shown from the
 * device straight away, and uploaded by the normal sync. Only a technician or
 * HOD who belongs to the machine's lab can set it; storage policies in
 * 0007_storage.sql enforce that on the server.
 */

export interface EquipmentRef {
  id: string;
  lab_id: string;
}

/**
 * The public passport is keyed by QR token and deliberately does not return
 * the internal id. A signed-in technician needs it to write, so look it up
 * through RLS (which only answers for their own labs), falling back to the
 * device copy when offline.
 */
export function useEquipmentRef(qrToken: string) {
  const { profile } = useAuth();
  const isWriter = profile?.role === 'technician' || profile?.role === 'lab_hod';

  const query = useQuery({
    queryKey: ['equipment-ref', qrToken],
    // Any signed-in person: leaders read documents through this id too.
    // RLS answers only for machines they may see; canWrite stays strict.
    enabled: Boolean(profile) && qrToken.length > 0,
    staleTime: Infinity,
    queryFn: async (): Promise<EquipmentRef | null> => {
      const { data, error } = await supabase
        .from('equipment')
        .select('id, lab_id')
        .eq('qr_token', qrToken)
        .maybeSingle();
      if (!error) return (data as EquipmentRef | null) ?? null;

      const cached = await db.equipment.where('qr_token').equals(qrToken).first();
      return cached ? { id: cached.id, lab_id: cached.lab_id } : null;
    },
  });

  const ref = query.data ?? null;
  const canWrite = Boolean(isWriter && ref && profile?.lab_ids.includes(ref.lab_id));
  return { ref, canWrite };
}

function pendingPhotoFor(equipmentId: string) {
  return db.outbox
    .where('kind')
    .equals('equipment_photo')
    .filter((item) => item.payload.equipment_id === equipmentId);
}

/**
 * Compress a photo and queue it as this machine's profile picture. Used by
 * the passport and by registration. Returns the storage path.
 */
export async function queueEquipmentPhoto(equipmentId: string, file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not a photo. Choose an image.');

  // A 6 MB phone photo will not go up over a campus link and would fill
  // IndexedDB. Always JPEG, to match the .jpg name and the bucket's list.
  const blob = await imageCompression(file, {
    maxSizeMB: 0.5,
    maxWidthOrHeight: 1600,
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: 0.82,
  });

  const id = crypto.randomUUID();
  const path = `${equipmentId}/${id}.jpg`;
  const files: OutboxItem['files'] = [{ field: 'photo', bucket: EQUIPMENT_PHOTO_BUCKET, path, blob }];

  await db.transaction('rw', db.outbox, db.equipment, async () => {
    // A newer snap replaces one still waiting to upload; no point sending both.
    await pendingPhotoFor(equipmentId).delete();
    await enqueue('equipment_photo', id, { equipment_id: equipmentId, photo_path: path }, files);
    await db.equipment.update(equipmentId, { photo_path: path });
  });
  return path;
}

/** Snap or pick a photo and make it this machine's profile picture. */
export function useSetEquipmentPhoto(equipmentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      if (!equipmentId) throw new Error('This machine is not loaded yet. Try again in a moment.');
      const path = await queueEquipmentPhoto(equipmentId, file);

      // Push now if there is a network; otherwise the next sweep does it.
      void sync()
        .then(() => queryClient.invalidateQueries())
        .catch(() => {
          /* the next sweep will try again */
        });
      return path;
    },
  });
}

/**
 * The photo still waiting in this device's outbox, as a displayable URL.
 * When it leaves the outbox (uploaded, possibly by a background sync) the
 * passport is refetched so the server copy takes over without a flash.
 */
export function usePendingEquipmentPhoto(equipmentId: string | undefined) {
  const queryClient = useQueryClient();
  const item = useLiveQuery(
    () => (equipmentId ? pendingPhotoFor(equipmentId).first() : undefined),
    [equipmentId],
  );
  const blob = item?.files?.[0]?.blob;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);

  const wasPending = useRef(false);
  useEffect(() => {
    if (item) wasPending.current = true;
    else if (wasPending.current) {
      wasPending.current = false;
      void queryClient.invalidateQueries({ queryKey: ['passport'] });
    }
  }, [item, queryClient]);

  return {
    previewUrl,
    isPending: Boolean(item),
    lastError: item && item.attempts > 0 ? item.last_error : undefined,
  };
}
