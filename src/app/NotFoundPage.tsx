import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

/**
 * Two jobs: an address that matches no route ("*" and router 404s), and
 * anything a screen throws. They read differently, because "page not found"
 * is the visitor's typo and "something went wrong" is ours.
 *
 * An unknown QR code is not handled here: the passport and lab board say so
 * themselves, in words that mention the label.
 */
export function NotFoundPage() {
  const navigate = useNavigate();
  const error = useRouteError();
  const crashed = Boolean(error) && !(isRouteErrorResponse(error) && error.status === 404);

  if (import.meta.env.DEV && error) {
    console.error('Route error:', error);
  }

  return (
    <div className="px-6 py-16 text-center">
      <Icon name={crashed ? 'error' : 'travel_explore'} size={40} className="text-ink-muted" />
      <h1 className="mt-4 text-[24px] font-semibold leading-[30px] text-ink-strong">
        {crashed ? 'Something went wrong' : 'Page not found'}
      </h1>
      <p className="mx-auto mt-2 max-w-[340px] text-[15px] leading-[23px] text-ink-muted">
        {crashed
          ? 'This screen hit an error. Reloading usually fixes it. Anything you saved is safe on this device.'
          : 'This address is not part of the app. If you were scanning a label, scan it again from the start.'}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {crashed ? (
          <Button intent="primary" icon="refresh" onClick={() => window.location.reload()}>
            Reload
          </Button>
        ) : (
          <Button intent="secondary" onClick={() => navigate(-1)}>
            Go back
          </Button>
        )}
        {/* "/" forwards a signed-in person to their own home, everyone else to sign in. */}
        <Button intent={crashed ? 'secondary' : 'primary'} icon="home" onClick={() => navigate('/')}>
          Home
        </Button>
      </div>
    </div>
  );
}
