import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Container } from '@/ui/Container';

const MIN_LENGTH = 10;

/**
 * Forced on first sign-in, because every account is seeded with a password
 * somebody typed into a file. Until this is done, no other route is reachable
 * (see RequireAuth).
 */
export function ChangePasswordPage() {
  const { profile } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters. Length matters more than symbols.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setBusy(false);
      setError(updateError.message);
      return;
    }

    if (profile) {
      await supabase.from('profiles').update({ must_change_password: false }).eq('id', profile.id);
    }

    setBusy(false);
    // Full reload so the auth context picks up the cleared flag.
    window.location.assign('/');
  }

  return (
    <Container width="form" className="py-10 sm:py-16">
      <h1 className="text-[28px] font-bold leading-8 tracking-[-0.015em] text-ink-strong sm:text-[32px] sm:leading-9">
        Choose your password
      </h1>
      <p className="mt-3 text-[15px] leading-[23px] text-ink-muted">
        Your account was created with a temporary password. Set your own before you carry on.
      </p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          help={`At least ${MIN_LENGTH} characters.`}
        />
        <Field
          label="Repeat the password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={error}
        />
        <Button type="submit" intent="primary" block disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </Button>
      </form>

      <Button intent="ghost" className="mt-4" onClick={() => void supabase.auth.signOut()}>
        Sign out instead
      </Button>
    </Container>
  );
}
