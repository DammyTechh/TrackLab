import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';

export type ButtonIntent = 'primary' | 'secondary' | 'ghost' | 'danger' | 'scan';
type Intent = ButtonIntent;

const INTENT: Record<Intent, string> = {
  primary: 'bg-brand text-ink-ondark hover:bg-brand-press border-transparent',
  secondary: 'bg-surface-raised text-ink-strong border-line-strong hover:bg-surface-sunken',
  ghost: 'bg-transparent text-brand border-transparent hover:bg-brand-surface px-3',
  danger: 'bg-urgent-ink text-ink-ondark border-transparent',
  // The only place the accent yellow is allowed: scanning and label printing.
  scan: 'bg-accent text-accent-ink border-accent-ink',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  intent?: Intent;
  icon?: string;
  block?: boolean;
}

/**
 * 48px minimum height, always — this is used with gloves on.
 * The label names what happens, and the toast that follows reuses the verb.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { intent = 'secondary', icon, block, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={[
        'inline-flex min-h-touch items-center justify-center gap-2 rounded-md border px-5',
        'text-[15px] font-semibold leading-5 transition-colors',
        'disabled:cursor-not-allowed disabled:border-line-subtle disabled:bg-surface-sunken disabled:text-ink-muted',
        INTENT[intent],
        block ? 'w-full' : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
});
