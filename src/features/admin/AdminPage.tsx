import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Container } from '@/ui/Container';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { useAuth } from '@/app/AuthProvider';

interface LabRow {
  id: string;
  name: string;
  code: string;
  building: string | null;
  room: string | null;
  public_token: string;
  is_active: boolean;
}

interface PersonRow {
  id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  lab_members: { lab_id: string }[];
}

const ROLE_LABEL: Record<string, string> = {
  technician: 'Technician',
  lab_hod: 'Lab HOD',
  senior_leader: 'Senior leader',
  admin: 'Administrator',
};

/**
 * Labs and accounts. Accounts are created by 0006_seed_users.sql or the
 * seed-users edge function, never here, because there is no sign-up. The
 * admin can switch an account off and on. Admins never edit equipment.
 */
export function AdminPage() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();

  const labs = useQuery({
    queryKey: ['admin-labs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('labs')
        .select('id, name, code, building, room, public_token, is_active')
        .order('code');
      if (error) throw error;
      return data as LabRow[];
    },
  });

  const counts = useQuery({
    queryKey: ['admin-equipment-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('equipment').select('lab_id');
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data as { lab_id: string }[]) map.set(row.lab_id, (map.get(row.lab_id) ?? 0) + 1);
      return map;
    },
  });

  const people = useQuery({
    queryKey: ['admin-people'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role, is_active, must_change_password, lab_members(lab_id)')
        .order('role')
        .order('full_name');
      if (error) throw error;
      return data as unknown as PersonRow[];
    },
  });

  const toggle = useMutation({
    mutationFn: async (person: PersonRow) => {
      const { error } = await supabase.from('profiles').update({ is_active: !person.is_active }).eq('id', person.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-people'] }),
  });

  const labCode = new Map((labs.data ?? []).map((lab) => [lab.id, lab.code]));

  return (
    <Container width="app" className="py-6 sm:py-8">
      <h1 className="m-0 text-[28px] font-bold leading-8 tracking-[-0.015em] text-ink-strong">Admin</h1>
      <p className="mb-0 mt-2 text-[15px] text-ink-muted">Labs and accounts. Equipment records are kept by each lab.</p>

      <h2 className="mb-3 mt-8 text-[19px] font-semibold text-ink-strong">Labs</h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0 md:hidden">
        {(labs.data ?? []).map((lab) => (
          <li key={lab.id} className="rounded-lg border border-line-subtle bg-surface-raised p-4">
            <p className="m-0 flex items-baseline justify-between gap-3">
              <span className="font-semibold text-ink-strong">{lab.name}</span>
              <span className="mono text-[13px] text-ink-muted">{lab.code}</span>
            </p>
            <p className="mb-0 mt-1 text-[14px] text-ink-muted">
              {[lab.building, lab.room].filter(Boolean).join(', ') || 'No location set'} · {counts.data?.get(lab.id) ?? 0}{' '}
              machines
            </p>
            <a href={`/l/${lab.public_token}`} className="mt-2 inline-flex min-h-touch items-center gap-1 font-semibold text-brand">
              Open entrance board <Icon name="open_in_new" size={18} />
            </a>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-lg border border-line-subtle bg-surface-raised md:block">
        <table className="w-full min-w-[44rem] border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-line-subtle text-ink-muted">
              <th className="px-4 py-3 font-semibold">Lab</th>
              <th className="px-4 py-3 font-semibold">Code</th>
              <th className="px-4 py-3 font-semibold">Where</th>
              <th className="px-4 py-3 font-semibold">Machines</th>
              <th className="px-4 py-3 font-semibold">Entrance board</th>
            </tr>
          </thead>
          <tbody>
            {(labs.data ?? []).map((lab) => (
              <tr key={lab.id} className="border-b border-line-subtle last:border-b-0">
                <td className="px-4 py-3 font-semibold text-ink-strong">{lab.name}</td>
                <td className="mono px-4 py-3">{lab.code}</td>
                <td className="px-4 py-3 text-ink">{[lab.building, lab.room].filter(Boolean).join(', ') || '—'}</td>
                <td className="px-4 py-3">{counts.data?.get(lab.id) ?? 0}</td>
                <td className="px-4 py-3">
                  <a href={`/l/${lab.public_token}`} className="inline-flex items-center gap-1 font-semibold text-brand">
                    Open <Icon name="open_in_new" size={18} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-8 text-[19px] font-semibold text-ink-strong">Accounts</h2>
      <p className="mb-3 mt-0 text-[14px] text-ink-muted">
        New accounts are added in <span className="mono">supabase/migrations/0006_seed_users.sql</span>. There is no
        sign-up page.
      </p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0 md:hidden">
        {(people.data ?? []).map((person) => (
          <li key={person.id} className="rounded-lg border border-line-subtle bg-surface-raised p-4">
            <p className="m-0 font-semibold text-ink-strong">{person.full_name}</p>
            <p className="mb-0 mt-1 text-[14px] text-ink-muted">
              {ROLE_LABEL[person.role] ?? person.role}
              {person.lab_members.length ? ' · ' : ''}
              <span className="mono text-[13px]">
                {person.lab_members.map((m) => labCode.get(m.lab_id)).filter(Boolean).join(', ')}
              </span>
            </p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <PersonState person={person} />
              {person.id !== profile?.id ? (
                <Button
                  intent={person.is_active ? 'secondary' : 'primary'}
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(person)}
                >
                  {person.is_active ? 'Deactivate' : 'Reactivate'}
                </Button>
              ) : (
                <span className="text-[13px] text-ink-muted">You</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-lg border border-line-subtle bg-surface-raised md:block">
        <table className="w-full min-w-[44rem] border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-line-subtle text-ink-muted">
              <th className="px-4 py-3 font-semibold">Name</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Labs</th>
              <th className="px-4 py-3 font-semibold">State</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(people.data ?? []).map((person) => (
              <tr key={person.id} className="border-b border-line-subtle last:border-b-0">
                <td className="px-4 py-3 font-semibold text-ink-strong">{person.full_name}</td>
                <td className="px-4 py-3">{ROLE_LABEL[person.role] ?? person.role}</td>
                <td className="mono px-4 py-3 text-[13px]">
                  {person.lab_members.map((m) => labCode.get(m.lab_id)).filter(Boolean).join(', ') || '—'}
                </td>
                <td className="px-4 py-3">
                  <PersonState person={person} />
                </td>
                <td className="px-4 py-3 text-right">
                  {person.id !== profile?.id ? (
                    <Button
                      intent={person.is_active ? 'secondary' : 'primary'}
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate(person)}
                    >
                      {person.is_active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  ) : (
                    <span className="text-[13px] text-ink-muted">You</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {toggle.isError ? (
        <p role="alert" className="mt-3 text-[14px] text-urgent-ink">
          That change was not saved. {toggle.error instanceof Error ? toggle.error.message : ''}
        </p>
      ) : null}
    </Container>
  );
}

function PersonState({ person }: { person: PersonRow }) {
  if (!person.is_active) return <span className="text-[14px] text-urgent-ink">Deactivated</span>;
  if (person.must_change_password) return <span className="text-[14px] text-attention-ink">Not signed in yet</span>;
  return <span className="text-[14px] text-brand">Active</span>;
}
