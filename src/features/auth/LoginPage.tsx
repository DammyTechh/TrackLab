import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/Container';
import { institution } from '@/lib/institution';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [artFailed, setArtFailed] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);

    if (signInError) {
      // Never say which half was wrong.
      setError('That email and password do not match an account. Check both and try again.');
      return;
    }
    navigate(location.state?.from ?? '/', { replace: true });
  }

  const art = institution.signinImage;
  const showArt = Boolean(art) && !artFailed;

  return (
    <div className={showArt ? 'lg:grid lg:min-h-[calc(100dvh-56px)] lg:grid-cols-2' : undefined}>
      {showArt ? (
        // Decorative, so alt="" and hidden from screen readers. Above the form
        // on phones and tablets, sized by screen height so the email field
        // stays visible without scrolling; its own panel beside the form on
        // desktops. The browser fetches the 640px file on a phone.
        <div
          aria-hidden="true"
          className="flex justify-center px-4 pt-5 sm:px-6 sm:pt-8 lg:order-2 lg:flex-col lg:items-center lg:justify-center lg:bg-brand-surface lg:p-12"
        >
          <img
            src={`${art}-1100.webp`}
            srcSet={`${art}-640.webp 640w, ${art}-1100.webp 1100w`}
            sizes="(min-width: 1024px) 34rem, 18rem"
            width={1100}
            height={967}
            alt=""
            decoding="async"
            onError={() => setArtFailed(true)}
            className="h-[min(25vh,15rem)] w-auto object-contain sm:h-[min(32vh,18rem)] lg:h-auto lg:w-full lg:max-w-[34rem]"
          />
          <p className="mt-6 hidden max-w-[26rem] text-center text-[15px] leading-[23px] text-ink-muted lg:block">
            Scan any label to see a machine&rsquo;s status. Sign in to record use, faults and servicing.
          </p>
        </div>
      ) : null}

      <div className={showArt ? 'lg:order-1 lg:flex lg:items-center' : undefined}>
        <Container width="form" className={showArt ? 'py-6 sm:py-10 lg:py-16' : 'py-10 sm:py-16'}>
          {/* The brand is already in the app header above; showing it again here
              was the duplicate logo. */}
          <h1 className="text-[28px] font-bold leading-8 tracking-[-0.015em] text-ink-strong sm:text-[32px] sm:leading-9">
            Staff sign in
          </h1>
          <p className="mt-3 text-[15px] leading-[23px] text-ink-muted">
            Accounts are created by the lab administrator. There is no sign-up.
          </p>

          <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
            <Field
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error}
            />
            <Button type="submit" intent="primary" block disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-6 flex items-start gap-[10px] text-[13px] leading-[19px] text-ink-muted">
            <Icon name="lan" size={18} className="shrink-0 text-calm-ink" />
            You can sign in on the campus network with no internet. Your session stays valid offline for 7 days.
          </p>
        </Container>
      </div>
    </div>
  );
}
