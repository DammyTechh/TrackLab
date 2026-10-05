import { useState } from 'react';
import { PhotoSource } from '@/ui/PhotoSource';
import { Icon } from '@/ui/Icon';
import { equipmentPhotoUrl } from '@/lib/supabase';
import { useNetwork } from '@/app/NetworkProvider';
import { usePendingEquipmentPhoto, useSetEquipmentPhoto } from './photo';

/**
 * The machine's photo, at the top of its passport. A visitor sees it and
 * knows they are at the right machine; a technician in that lab can snap a
 * new one on the spot.
 *
 * "Take photo" opens a live viewfinder from the device camera; "Upload"
 * picks a photo already on the device (see ui/PhotoSource).
 */
export function EquipmentPhoto({
  equipmentId,
  equipmentName,
  photoPath,
  canEdit,
}: {
  equipmentId: string | undefined;
  equipmentName: string;
  photoPath: string | null;
  canEdit: boolean;
}) {
  const [brokenUrl, setBrokenUrl] = useState<string | null>(null);
  const { state } = useNetwork();
  const setPhoto = useSetEquipmentPhoto(equipmentId);
  const pending = usePendingEquipmentPhoto(canEdit ? equipmentId : undefined);

  const serverUrl = equipmentPhotoUrl(photoPath);
  const shownUrl = pending.previewUrl ?? serverUrl;
  const hasImage = Boolean(shownUrl && shownUrl !== brokenUrl);

  if (!hasImage && !canEdit) return null;

  let statusLine: { icon: string; text: string; tone: 'muted' | 'attention' | 'urgent' } | null = null;
  if (setPhoto.isPending) {
    statusLine = { icon: 'hourglass_top', text: 'Preparing the photo on this phone…', tone: 'muted' };
  } else if (setPhoto.isError) {
    statusLine = {
      icon: 'error',
      text: setPhoto.error instanceof Error ? setPhoto.error.message : 'That photo could not be saved.',
      tone: 'urgent',
    };
  } else if (pending.isPending) {
    statusLine = pending.lastError
      ? {
          icon: 'sync_problem',
          text: 'Saved on this phone. The upload has not gone through yet; it retries by itself.',
          tone: 'attention',
        }
      : state === 'offline'
        ? { icon: 'cloud_off', text: 'Saved on this phone. It uploads when the network returns.', tone: 'attention' }
        : { icon: 'cloud_upload', text: 'Uploading…', tone: 'muted' };
  }

  const toneClass = {
    muted: 'text-ink-muted',
    attention: 'text-attention-ink',
    urgent: 'text-urgent-ink',
  } as const;

  return (
    <figure className="m-0 mb-4">
      {hasImage ? (
        <img
          src={shownUrl ?? undefined}
          alt={equipmentName}
          onError={() => setBrokenUrl(shownUrl)}
          className="block aspect-[4/3] max-h-[340px] w-full rounded-xl bg-surface-sunken object-cover"
        />
      ) : (
        <div className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface-raised px-6 text-center">
          <Icon name="add_a_photo" size={40} className="text-brand" />
          <p className="m-0 text-[15px] font-semibold leading-[21px] text-ink-strong">No photo of this machine yet</p>
          <p className="m-0 max-w-[22rem] text-[13px] leading-[19px] text-ink-muted">
            Snap it so anyone scanning the label can tell they are at the right machine.
          </p>
        </div>
      )}

      {canEdit ? (
        <figcaption className="mt-3">
          <PhotoSource
            onFiles={([file]) => file && setPhoto.mutate(file)}
            disabled={setPhoto.isPending || !equipmentId}
            takeLabel={hasImage ? 'Retake' : 'Take photo'}
            takeIntent={hasImage ? 'secondary' : 'primary'}
          />

          {statusLine ? (
            <p
              role="status"
              className={`mb-0 mt-2 flex items-start gap-2 text-[13px] leading-[19px] ${toneClass[statusLine.tone]}`}
            >
              <Icon name={statusLine.icon} size={18} className="shrink-0" />
              {statusLine.text}
            </p>
          ) : (
            <p className="mb-0 mt-2 text-[13px] leading-[19px] text-ink-muted">
              Compressed on this phone before upload, so it works on a weak connection.
            </p>
          )}
        </figcaption>
      ) : null}
    </figure>
  );
}
