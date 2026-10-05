import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';

type Facing = 'environment' | 'user';
type Phase = 'starting' | 'live' | 'review' | 'error';

/** False on plain-http addresses (other than localhost) and very old browsers. */
export function liveCameraAvailable(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;
}

function cameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera permission was refused. Allow the camera for this site in your browser settings, or use Upload instead.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No camera was found on this device. Use Upload to choose a photo instead.';
  if (name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.';
  return 'The camera could not be started. Use Upload to choose a photo instead.';
}

/**
 * A live viewfinder from the device camera, full screen. The person frames
 * the machine, takes the shot, checks it, and either uses it or retakes it.
 * Works on phones, tablets and laptops with a webcam. Browsers only allow the
 * camera on https or localhost; elsewhere the caller falls back to Upload.
 */
export function CameraCapture({
  open,
  onClose,
  onCapture,
  title = 'Take photo',
}: {
  open: boolean;
  onClose: () => void;
  onCapture: (file: File) => void;
  title?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const shutter = useRef<HTMLButtonElement>(null);
  const [facing, setFacing] = useState<Facing>('environment');
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState('');
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [canSwitch, setCanSwitch] = useState(false);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  // Start (or restart, when switching cameras) the live stream.
  useEffect(() => {
    if (!open || shot) return;
    let cancelled = false;
    setPhase('starting');

    if (!liveCameraAvailable()) {
      setError(
        window.isSecureContext
          ? 'This browser cannot open the camera. Use Upload to choose a photo instead.'
          : 'The live camera only works on a secure (https) address. Use Upload to choose a photo instead.',
      );
      setPhase('error');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      })
      .then(async (media) => {
        if (cancelled) return media.getTracks().forEach((t) => t.stop());
        stop();
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play().catch(() => undefined);
        }
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setCanSwitch(devices.filter((d) => d.kind === 'videoinput').length > 1);
        setPhase('live');
        shutter.current?.focus();
      })
      .catch((err) => {
        if (cancelled) return;
        setError(cameraError(err));
        setPhase('error');
      });

    return () => {
      cancelled = true;
    };
  }, [open, facing, shot, stop]);

  // Release the camera whenever the sheet closes or the screen unmounts.
  useEffect(() => {
    if (!open) {
      stop();
      setShot(null);
      setError('');
    }
    return stop;
  }, [open, stop]);

  useEffect(() => () => {
    if (shot) URL.revokeObjectURL(shot.url);
  }, [shot]);

  // Escape closes; the page behind does not scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  function takeShot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stop();
        setShot({ blob, url: URL.createObjectURL(blob) });
        setPhase('review');
      },
      'image/jpeg',
      0.92,
    );
  }

  function usePhoto() {
    if (!shot) return;
    onCapture(new File([shot.blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    onClose();
  }

  if (!open) return null;

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-ink-strong text-ink-ondark">
      <div className="flex items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <p className="m-0 text-[16px] font-semibold">{title}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close camera"
          className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-surface-plate"
        >
          <Icon name="close" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {phase === 'review' && shot ? (
          <img src={shot.url} alt="The shot you just took" className="max-h-full max-w-full object-contain" />
        ) : (
          <video
            ref={video}
            playsInline
            muted
            autoPlay
            className={`h-full w-full object-contain ${phase === 'live' ? '' : 'invisible'}`}
          />
        )}

        {phase === 'starting' ? (
          <p className="absolute m-0 flex items-center gap-2 text-[15px]">
            <Icon name="photo_camera" /> Starting the camera…
          </p>
        ) : null}

        {phase === 'error' ? (
          <div className="absolute mx-6 max-w-[24rem] rounded-xl bg-surface-raised p-5 text-center text-ink">
            <Icon name="no_photography" size={40} className="text-urgent-ink" />
            <p className="mb-4 mt-2 text-[15px] leading-[22px]">{error}</p>
            <Button intent="primary" block onClick={onClose}>
              Close
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-center gap-6 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {phase === 'review' ? (
          <>
            <Button intent="secondary" icon="replay" onClick={() => setShot(null)}>
              Retake
            </Button>
            <Button intent="scan" icon="check" onClick={usePhoto}>
              Use photo
            </Button>
          </>
        ) : phase === 'live' ? (
          <>
            <span className="w-12" />
            <button
              ref={shutter}
              type="button"
              onClick={takeShot}
              aria-label="Take the photo"
              className="h-[72px] w-[72px] rounded-full border-[5px] border-ink-ondark bg-accent focus-visible:outline-offset-4"
            />
            {canSwitch ? (
              <button
                type="button"
                onClick={() => setFacing(facing === 'environment' ? 'user' : 'environment')}
                aria-label="Switch camera"
                className="flex h-12 w-12 items-center justify-center rounded-full hover:bg-surface-plate"
              >
                <Icon name="cameraswitch" />
              </button>
            ) : (
              <span className="w-12" />
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
