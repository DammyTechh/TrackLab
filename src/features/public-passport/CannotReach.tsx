import { Container } from '@/ui/Container';
import { Icon } from '@/ui/Icon';
import { Button } from '@/ui/Button';
import { describeError } from '@/lib/errors';

/**
 * The server did not answer. Says why, in words that are true wherever the
 * app is hosted: online for everyone, or on a campus server.
 */
export function CannotReach({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <Container className="py-16 text-center">
      <Icon name="wifi_off" size={40} className="text-ink-muted" />
      <h1 className="mt-4 text-[19px] font-semibold text-ink-strong">{what} can&rsquo;t load right now</h1>
      <p className="mx-auto mt-2 max-w-[22rem] text-[15px] leading-[23px] text-ink-muted">
        {offline
          ? 'This phone has no connection. Turn on mobile data or join Wi-Fi, then try again.'
          : 'The server did not answer. Wait a moment and try again.'}
      </p>
      <div className="mt-6 flex justify-center">
        <Button intent="secondary" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      </div>
      {!offline && error ? (
        <p className="mx-auto mt-6 max-w-[26rem] text-[13px] leading-[19px] text-ink-muted">
          Reason: {describeError(error, 'no reply from the server')}
        </p>
      ) : null}
    </Container>
  );
}
