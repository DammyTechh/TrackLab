import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/Container';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

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

  return (
    <Container width="form" className="py-10 sm:py-16">
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
  );
}
