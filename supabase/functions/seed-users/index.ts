// seed-users — creates the only accounts that will ever exist.
//
// There is no sign-up page and Supabase Auth has sign-ups disabled. Run this
// once per deployment with the private users.<code>.json, which is never
// committed. Service role only.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { requireService } from '../_shared/requireService.ts';

const ROLES = ['technician', 'lab_hod', 'senior_leader', 'admin'] as const;

interface SeedUser {
  email: string;
  full_name: string;
  role: 'technician' | 'lab_hod' | 'senior_leader' | 'admin';
  labs: string[];
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Creates accounts with any role, including admin. Without this check the
  // public anon key was enough to call it. See _shared/caller.ts.
  const forbidden = requireService(request);
  if (forbidden) return forbidden;

  const { defaultPassword, users } = (await request.json()) as {
    defaultPassword: string;
    users: SeedUser[];
  };

  if (typeof defaultPassword !== 'string' || defaultPassword.length < 10) {
    return Response.json({ error: 'defaultPassword must be at least 10 characters.' }, { status: 400 });
  }
  const invalid = (users ?? []).filter(
    (u) => !u?.email?.includes('@') || !u.full_name || !ROLES.includes(u.role) || !Array.isArray(u.labs),
  );
  if (!Array.isArray(users) || invalid.length > 0) {
    return Response.json(
      { error: 'Every user needs email, full_name, labs[] and a role of ' + ROLES.join(', '), invalid },
      { status: 400 },
    );
  }

  const created: string[] = [];
  const skipped: string[] = [];

  for (const user of users) {
    const { data: auth, error } = await supabase.auth.admin.createUser({
      email: user.email,
      password: defaultPassword,
      email_confirm: true,
    });

    if (error || !auth.user) {
      skipped.push(`${user.email}: ${error?.message ?? 'unknown'}`);
      continue;
    }

    // must_change_password is true by default: the first sign-in forces a change.
    await supabase.from('profiles').insert({
      id: auth.user.id,
      full_name: user.full_name,
      role: user.role,
    });

    if (user.labs.length > 0) {
      const { data: labs } = await supabase.from('labs').select('id, code').in('code', user.labs);
      if (labs?.length) {
        await supabase
          .from('lab_members')
          .insert(labs.map((lab) => ({ lab_id: lab.id, profile_id: auth.user!.id })));
      }
    }

    created.push(user.email);
  }

  return new Response(JSON.stringify({ created, skipped }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
