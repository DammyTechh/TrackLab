import { useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';
import { Container } from '@/ui/Container';
import { institution } from '@/lib/institution';
import { describeError } from '@/lib/errors';
import { AuthLayout } from './AuthLayout';
import { signInMessage } from './signInMessage';

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

    const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError || !signedIn.user) {
      setBusy(false);
      setError(signInMessage(signInError));
      return;
    }

    // The password was right. Make sure an account stands behind it before
    // going on: a sign-in added in the Supabase dashboard alone has no
    // profile, and without this check it bounced back here with no reason.
    const { data: account, error: accountError } = await supabase
      .from('profiles')
      .select('is_active')
      .eq('id', signedIn.user.id)
      .maybeSingle();
    if (accountError || !account || !account.is_active) {
      await supabase.auth.signOut({ scope: 'local' });
      setBusy(false);
      setError(
        accountError
          ? describeError(accountError, 'Signed in, but the account could not be loaded. Try again.')
          : !account
            ? `This sign-in has no ${institution.productName} account behind it. Ask the administrator to set it up: adding someone in the Supabase dashboard alone is not enough.`
            : 'This account has been switched off. Ask the administrator.',
      );
      return;
    }

    setBusy(false);
    navigate(location.state?.from ?? '/', { replace: true });
  }

  return (
    <AuthLayout>
      <Container width="form" className="py-6 sm:py-10 lg:py-16">
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
          Once you have signed in, this device keeps working without a connection for up to 7 days, and sends
          what you record when it is back online.
        </p>
      </Container>
    </AuthLayout>
  );
}
