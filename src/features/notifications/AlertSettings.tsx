import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/app/AuthProvider';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

type Level = 'all' | 'critical' | 'none';

interface Settings {
  email: Level;
  push: Level;
  weekly_digest: boolean;
}

/**
 * What reaches this person outside the app. The list on this page is always
 * kept: it is the record, and on a campus network with no internet it is the
 * only channel that works. These settings only shape email and push (0010).
 */
export function AlertSettings() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const isLeader = profile?.role === 'senior_leader' || profile?.role === 'admin';

  const saved = useQuery({
    queryKey: ['alert-settings'],
    queryFn: async (): Promise<Settings> => {
      const { data, error } = await supabase.rpc('my_alert_settings');
      if (error) throw error;
      const [row] = (data ?? []) as Settings[];
      if (!row) throw new Error('No settings returned.');
      return row;
    },
  });

  const [draft, setDraft] = useState<Settings | null>(null);
  useEffect(() => {
    if (saved.data) setDraft(saved.data);
  }, [saved.data]);

  const save = useMutation({
    mutationFn: async (next: Settings) => {
      if (!profile) throw new Error('Sign in again to change your alerts.');
      const { error } = await supabase
        .from('notification_settings')
        .upsert({ profile_id: profile.id, ...next, updated_at: new Date().toISOString() }, { onConflict: 'profile_id' });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alert-settings'] }),
  });

  if (saved.isError) {
    return (
      <section className="mt-8 rounded-lg border border-line-subtle bg-surface-raised p-4">
        <h2 className="m-0 text-[16px] font-semibold leading-[22px] text-ink-strong">What reaches you</h2>
        <p className="mb-0 mt-2 text-[14px] text-ink-muted">Your alert settings need a connection to load.</p>
      </section>
    );
  }
  if (!draft || !saved.data) return null;

  const dirty =
    draft.email !== saved.data.email ||
    draft.push !== saved.data.push ||
    draft.weekly_digest !== saved.data.weekly_digest;

  // A leader is only ever sent critical alerts, so offering "every alert"
  // would promise something that cannot happen.
  const options: { value: Level; label: string }[] = isLeader
    ? [
        { value: 'critical', label: 'Critical' },
        { value: 'none', label: 'Off' },
      ]
    : [
        { value: 'all', label: 'Every alert' },
        { value: 'critical', label: 'Critical only' },
        { value: 'none', label: 'Off' },
      ];
  const normalise = (level: Level): Level => (isLeader && level === 'all' ? 'critical' : level);

  return (
    <section className="mt-8 rounded-lg border border-line-subtle bg-surface-raised p-4">
      <h2 className="m-0 text-[16px] font-semibold leading-[22px] text-ink-strong">What reaches you</h2>
      <p className="mb-0 mt-2 text-[14px] leading-5 text-ink-muted">
        {isLeader
          ? 'Critical alerts from every laboratory: critical faults, overdue servicing and replacement recommendations. Off unless you turn them on.'
          : 'Alerts for the machines in your laboratories. Critical means faults, overdue servicing and replacement recommendations.'}{' '}
        This page always keeps the full list.
      </p>

      <Choice
        label="Email"
        options={options}
        value={normalise(draft.email)}
        onChange={(email) => setDraft({ ...draft, email })}
      />
      <Choice
        label="Push notifications"
        hint="Also needs notifications turned on for this device, below."
        options={options}
        value={normalise(draft.push)}
        onChange={(push) => setDraft({ ...draft, push })}
      />

      <div className="mt-5 flex items-start gap-3">
        <input
          id="weekly-digest"
          type="checkbox"
          aria-describedby="weekly-digest-hint"
          checked={draft.weekly_digest}
          onChange={(e) => setDraft({ ...draft, weekly_digest: e.target.checked })}
          className="mt-[14px] h-[20px] w-[20px] shrink-0 accent-brand"
        />
        <div>
          <label
            htmlFor="weekly-digest"
            className="flex min-h-touch cursor-pointer items-center text-[15px] font-semibold leading-[21px] text-ink-strong"
          >
            Weekly summary by email
          </label>
          <p id="weekly-digest-hint" className="m-0 text-[13px] leading-[19px] text-ink-muted">
            Monday morning: what is overdue, faulty or awaiting a replacement decision{' '}
            {isLeader ? 'across every laboratory' : 'in your laboratories'}. Sent even when nothing is outstanding.
          </p>
        </div>
      </div>

      {save.isError ? (
        <p role="alert" className="mb-0 mt-3 flex items-start gap-2 text-[13px] text-urgent-ink">
          <Icon name="error" filled size={18} className="shrink-0" />
          {save.error instanceof Error ? save.error.message : 'Those settings could not be saved.'}
        </p>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <Button intent="primary" icon="save" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
          {save.isPending ? 'Saving…' : 'Save alert settings'}
        </Button>
        {!dirty && save.isSuccess ? (
          <span className="flex items-center gap-1 text-[13px] text-ink-muted">
            <Icon name="check" size={18} />
            Saved
          </span>
        ) : null}
      </div>
    </section>
  );
}

function Choice({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: { value: Level; label: string }[];
  value: Level;
  onChange: (value: Level) => void;
}) {
  return (
    <fieldset className="m-0 mt-5 border-0 p-0">
      <legend className="mb-2 p-0 text-[14px] font-semibold leading-[18px] text-ink-strong">{label}</legend>
      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={[
              'min-h-touch flex-1 rounded-md border px-2 text-[14px] font-semibold',
              value === option.value
                ? 'border-brand bg-brand text-ink-ondark'
                : 'border-line-strong bg-surface-raised text-ink',
            ].join(' ')}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint ? <p className="mb-0 mt-2 text-[13px] leading-[19px] text-ink-muted">{hint}</p> : null}
    </fieldset>
  );
}
