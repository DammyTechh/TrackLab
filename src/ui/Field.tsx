import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * Label above, help below, error replacing help so the field never jumps
 * twice. Mono input for anything copied off an engraved plate.
 *
 * A custom control (textarea, select, pill group) is passed as a render
 * function so it receives the SAME id the label points at, plus the
 * describedby and invalid wiring. Passing bare children would leave the
 * label pointing at nothing — a silent accessibility break.
 */
export interface ControlProps {
  id: string;
  'aria-describedby': string | undefined;
  'aria-invalid': true | undefined;
}

export function Field({
  label,
  required,
  help,
  error,
  mono,
  children,
  ...rest
}: {
  label: string;
  required?: boolean;
  help?: string;
  error?: string;
  mono?: boolean;
  children?: (control: ControlProps) => ReactNode;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'children'>) {
  const id = useId();
  const describedBy = error ? `${id}-error` : help ? `${id}-help` : undefined;
  const control: ControlProps = {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[14px] font-semibold leading-[18px] text-ink-strong">
        {label}
        {required ? <span className="text-urgent-ink"> *</span> : null}
      </label>

      {children ? (
        children(control)
      ) : (
        <input
          {...control}
          className={[
            'min-h-touch w-full rounded-md bg-surface-raised px-4 py-3 text-ink-strong',
            'text-[15px] leading-[23px] placeholder:text-ink-muted',
            mono ? 'mono tracking-[0.02em]' : '',
            error ? 'border-2 border-urgent-ink' : 'border border-line-strong',
          ].join(' ')}
          {...rest}
        />
      )}

      {error ? (
        <span
          id={`${id}-error`}
          className="flex items-center gap-1 text-[13px] font-medium leading-[19px] text-urgent-ink"
        >
          <Icon name="error" filled size={18} />
          {error}
        </span>
      ) : help ? (
        <span id={`${id}-help`} className="text-[13px] leading-[19px] text-ink-muted">
          {help}
        </span>
      ) : null}
    </div>
  );
}

/** The shared control styling, so a custom control still looks like a field. */
export const controlClass = (invalid?: boolean) =>
  [
    'w-full rounded-md bg-surface-raised px-4 py-3 text-[15px] leading-[23px] text-ink-strong',
    invalid ? 'border-2 border-urgent-ink' : 'border border-line-strong',
  ].join(' ');
