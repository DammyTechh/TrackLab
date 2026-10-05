import type { ReactNode } from 'react';

/**
 * Every screen sits in one of three columns. Without this the login form
 * stretches to 1900px on a desktop monitor and a passport becomes unreadable.
 *
 *   form     a single column of fields
 *   reading  a passport, a lab board, an event form — phone layouts that stay
 *            phone-shaped on a desktop, because that is how they are used
 *   app      dashboards and tables, which genuinely want the width
 */
const WIDTH = {
  form: 'max-w-[26rem]',
  reading: 'max-w-[36rem]',
  app: 'max-w-[80rem]',
} as const;

export function Container({
  width = 'reading',
  className = '',
  children,
}: {
  width?: keyof typeof WIDTH;
  className?: string;
  children: ReactNode;
}) {
  return <div className={`mx-auto w-full ${WIDTH[width]} px-4 sm:px-6 ${className}`}>{children}</div>;
}

/**
 * The action bar at the foot of a passport or a form. Sticky rather than
 * fixed, so it stays inside its column on a desktop instead of spanning the
 * whole window, and so no screen needs padding at the bottom to clear it.
 * The bottom padding clears a phone's home indicator.
 */
export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div
      className={[
        'sticky bottom-0 z-10 -mx-4 mt-8 sm:-mx-6',
        'border-t border-line-subtle bg-surface-raised',
        'px-4 pt-3 sm:px-6',
        'pb-[max(1.25rem,env(safe-area-inset-bottom))]',
      ].join(' ')}
    >
      <div className="flex gap-3">{children}</div>
    </div>
  );
}
