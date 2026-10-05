import { useRef, useState, type ChangeEvent } from 'react';
import { Button, type ButtonIntent } from './Button';
import { CameraCapture, liveCameraAvailable } from './CameraCapture';

/**
 * The two ways to add a photo, everywhere in the app:
 *
 *   Take photo  a live viewfinder from the device camera (CameraCapture).
 *               Where the browser cannot open the camera live (plain http on
 *               a phone), it falls back to the phone's own camera app.
 *   Upload      a photo already on the device, from the gallery or files.
 */
export function PhotoSource({
  onFiles,
  multiple = false,
  disabled = false,
  takeLabel = 'Take photo',
  uploadLabel = 'Upload',
  takeIntent = 'primary',
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  takeLabel?: string;
  uploadLabel?: string;
  takeIntent?: ButtonIntent;
}) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);

  function picked(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Clear it so choosing the same file again still fires a change.
    event.target.value = '';
    if (files.length) onFiles(files);
  }

  function take() {
    if (liveCameraAvailable()) setCameraOpen(true);
    else nativeCamera.current?.click();
  }

  return (
    <>
      <div className="flex gap-3">
        <Button intent={takeIntent} icon="photo_camera" block disabled={disabled} onClick={take}>
          {takeLabel}
        </Button>
        <Button intent="secondary" icon="upload" block disabled={disabled} onClick={() => upload.current?.click()}>
          {uploadLabel}
        </Button>
      </div>

      {/* Driven by the buttons above, which carry the accessible names. */}
      <input
        ref={nativeCamera}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={picked}
      />
      <input
        ref={upload}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={picked}
      />

      <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={(file) => onFiles([file])} />
    </>
  );
}
