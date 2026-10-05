import { useEffect, useState } from 'react';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { pushState, turnOffPush, turnOnPush, type PushState } from './push';

const COPY: Record<PushState['kind'], { icon: string; text: string }> = {
  on: { icon: 'notifications_active', text: 'This device gets a notification for each new alert.' },
  off: {
    icon: 'notifications',
    text: 'Get a notification on this device for faults, due dates and replacement recommendations, even with the app closed.',
  },
  denied: {
    icon: 'notifications_off',
    text: 'Notifications are blocked for this site. Allow them in the browser’s site settings to turn this on.',
  },
  'ios-install': {
    icon: 'ios_share',
    text: 'On iPhone and iPad, notifications only work once the app is on the home screen: tap Share, then “Add to Home Screen”, and open it from there.',
  },
  unsupported: {
    icon: 'notifications_off',
    text: 'This browser cannot receive notifications. Alerts still appear on this page.',
  },
  unconfigured: {
    icon: 'notifications_off',
    text: 'Notifications are not set up for this deployment yet. Alerts still appear on this page and by email.',
  },
};

/** Per-device opt-in. Push is an extra; the alert list above always works. */
export function PushSettings() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  if (!state) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setState(await pushState());
      setBusy(false);
    }
  }

  const copy = COPY[state.kind];

  return (
    <section className="mt-8 rounded-lg border border-line-subtle bg-surface-raised p-4">
      <h2 className="m-0 text-[16px] font-semibold leading-[22px] text-ink-strong">
        Notifications on this device
      </h2>
      <p className="mb-0 mt-2 flex items-start gap-2 text-[14px] leading-5 text-ink">
        <Icon name={copy.icon} size={20} className="shrink-0 text-ink-muted" />
        {copy.text}
      </p>

      {error ? (
        <p role="alert" className="mb-0 mt-3 flex items-start gap-2 text-[13px] text-urgent-ink">
          <Icon name="error" filled size={18} className="shrink-0" />
          {error}
        </p>
      ) : null}

      {state.kind === 'off' ? (
        <Button
          intent="primary"
          icon="notifications_active"
          className="mt-4"
          disabled={busy}
          onClick={() => void run(turnOnPush)}
        >
          {busy ? 'Turning on…' : 'Turn on notifications'}
        </Button>
      ) : null}
      {state.kind === 'on' ? (
        <Button
          intent="secondary"
          icon="notifications_off"
          className="mt-4"
          disabled={busy}
          onClick={() => void run(turnOffPush)}
        >
          {busy ? 'Turning off…' : 'Turn off on this device'}
        </Button>
      ) : null}

      <p className="mb-0 mt-3 text-[13px] leading-[19px] text-ink-muted">
        Signing out turns notifications off on this device, so a shared phone never shows the last person’s
        alerts.
      </p>
    </section>
  );
}
