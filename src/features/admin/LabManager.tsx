import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { describeError } from '@/lib/errors';
import { Button } from '@/ui/Button';
import { Field } from '@/ui/Field';
import { Icon } from '@/ui/Icon';

export interface LabRow {
  id: string;
  name: string;
  code: string;
  building: string | null;
  room: string | null;
  public_token: string;
  is_active: boolean;
}

interface Draft {
  name: string;
  code: string;
  building: string;
  room: string;
}

const EMPTY: Draft = { name: '', code: '', building: '', room: '' };

/** The same rule the database enforces (labs_code_shape), said in words. */
export function checkLab(draft: Draft): string | undefined {
  if (!draft.name.trim()) return 'Give the lab a name.';
  if (!/^[A-Z0-9]{2,10}$/.test(draft.code)) {
    return 'The code is 2 to 10 capital letters or digits, with no spaces: it goes into every asset ID, as in CHEM1.';
  }
  return undefined;
}

/**
 * Labs: add one, change its details, switch it off or on. There is no
 * delete: a lab's machines and history stay, and so do its printed labels.
 * A lab's code is part of its machines' asset IDs, so it is locked once the
 * lab has any; the database enforces the same rules.
 */
export function LabManager({ labs, counts }: { labs: LabRow[]; counts: Map<string, number> }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<LabRow | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string>();

  const machinesIn = (lab: LabRow) => counts.get(lab.id) ?? 0;
  const codeLocked = editing !== null && editing !== 'new' && machinesIn(editing) > 0;

  function open(target: LabRow | 'new') {
    setEditing(target);
    setError(undefined);
    setDraft(
      target === 'new'
        ? EMPTY
        : { name: target.name, code: target.code, building: target.building ?? '', room: target.room ?? '' },
    );
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-labs'] });
    void queryClient.invalidateQueries({ queryKey: ['my-labs'] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        name: draft.name.trim(),
        building: draft.building.trim() || null,
        room: draft.room.trim() || null,
        ...(codeLocked ? {} : { code: draft.code }),
      };
      const { error: saveError } =
        editing === 'new'
          ? await supabase.from('labs').insert({ ...row, code: draft.code })
          : await supabase.from('labs').update(row).eq('id', (editing as LabRow).id);
      if (saveError) throw saveError;
    },
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
    onError: (err) => {
      const code = (err as { code?: string }).code;
      setError(
        code === '23505'
          ? `There is already a lab with the code ${draft.code}. Each lab needs its own.`
          : describeError(err, 'The lab was not saved. Try again.'),
      );
    },
  });

  const toggle = useMutation({
    mutationFn: async (lab: LabRow) => {
      const { error: toggleError } = await supabase.from('labs').update({ is_active: !lab.is_active }).eq('id', lab.id);
      if (toggleError) throw toggleError;
    },
    onSuccess: refresh,
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = checkLab(draft);
    if (problem) return setError(problem);
    setError(undefined);
    save.mutate();
  }

  const where = (lab: LabRow) => [lab.building, lab.room].filter(Boolean).join(', ');

  return (
    <section aria-labelledby="labs-heading">
      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-3">
        <h2 id="labs-heading" className="m-0 text-[19px] font-semibold text-ink-strong">
          Labs
        </h2>
        {editing === null ? (
          <Button intent="secondary" icon="add" onClick={() => open('new')}>
            Add lab
          </Button>
        ) : null}
      </div>

      {editing !== null ? (
        <form
          onSubmit={onSubmit}
          className="mb-4 rounded-lg border border-line-subtle bg-surface-raised p-4 sm:p-5"
          aria-label={editing === 'new' ? 'Add lab' : `Edit ${editing.name}`}
        >
          <h3 className="m-0 text-[17px] font-semibold text-ink-strong">
            {editing === 'new' ? 'Add a lab' : `Edit ${editing.name}`}
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Name"
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Chemistry Lab 3"
            />
            <Field
              label="Code"
              required
              value={draft.code}
              disabled={codeLocked}
              maxLength={10}
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
              placeholder="CHEM3"
              help={
                codeLocked
                  ? `Locked: it is part of the asset IDs of this lab's ${machinesIn(editing as LabRow)} machine(s).`
                  : 'Goes into every asset ID in this lab, e.g. TRACKLAB-CHEM3-0001. Cannot change once a machine is registered.'
              }
            />
            <Field
              label="Building"
              value={draft.building}
              onChange={(e) => setDraft({ ...draft, building: e.target.value })}
              placeholder="Science Block A"
            />
            <Field
              label="Room"
              value={draft.room}
              onChange={(e) => setDraft({ ...draft, room: e.target.value })}
              placeholder="G12"
            />
          </div>
          {error ? (
            <p role="alert" className="mb-0 mt-4 flex items-start gap-2 text-[14px] leading-5 text-urgent-ink">
              <Icon name="error" filled size={18} className="shrink-0" />
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button type="submit" intent="primary" icon="save" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : editing === 'new' ? 'Add lab' : 'Save changes'}
            </Button>
            <Button type="button" intent="secondary" onClick={() => setEditing(null)} disabled={save.isPending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {toggle.isError ? (
        <p role="alert" className="mb-3 mt-0 text-[14px] text-urgent-ink">
          {describeError(toggle.error, 'That change was not saved.')}
        </p>
      ) : null}

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {labs.map((lab) => (
          <li
            key={lab.id}
            className={`rounded-lg border border-line-subtle bg-surface-raised p-4 ${lab.is_active ? '' : 'opacity-70'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-semibold text-ink-strong">{lab.name}</span>
                  <span className="mono text-[13px] text-ink-muted">{lab.code}</span>
                  {lab.is_active ? null : (
                    <span className="rounded-full bg-calm-tint px-2 py-[2px] text-[12px] font-semibold text-calm-ink">
                      Switched off
                    </span>
                  )}
                </p>
                <p className="mb-0 mt-1 text-[14px] text-ink-muted">
                  {where(lab) || 'No location set'} · {machinesIn(lab)} machine{machinesIn(lab) === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/l/${lab.public_token}`}
                  className="inline-flex min-h-touch items-center gap-1 px-2 text-[14px] font-semibold text-brand"
                >
                  Entrance board <Icon name="open_in_new" size={18} />
                </a>
                <Button intent="secondary" icon="edit" onClick={() => open(lab)} disabled={editing !== null}>
                  Edit
                </Button>
                <Button
                  intent="secondary"
                  onClick={() => toggle.mutate(lab)}
                  disabled={toggle.isPending || editing !== null}
                >
                  {lab.is_active ? 'Switch off' : 'Switch on'}
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="mb-0 mt-3 max-w-[44rem] text-[13px] leading-[19px] text-ink-muted">
        A switched-off lab keeps its machines and history, but takes no new registrations and its entrance board
        stops showing. Labs are never deleted.
      </p>
    </section>
  );
}
