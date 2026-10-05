// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { as, labId, machine, migrated, rows, userId, type Db } from './harness';

/**
 * The database rules the whole product depends on, executed against real
 * PostgreSQL as each role. If one of these fails, a guarantee the README
 * makes is no longer true.
 */

let db: Db;
let tech: string; // technician in CHEM1 + CHEM2
let physTech: string; // technician in PHY1 only
let chem2: string;

beforeAll(async () => {
  db = await migrated();
  tech = await userId(db, 'tech.chem@test.local');
  physTech = await userId(db, 'tech.phy@test.local');
  chem2 = await labId(db, 'CHEM2');
}, 60_000);

const asTech = <T>(fn: () => Promise<T>) => as(db, 'authenticated', tech, fn);

describe('the migrations', () => {
  it('apply cleanly, with the test fixture in place', async () => {
    const [counts] = await rows<{ labs: number; people: number }>(
      db,
      'select (select count(*)::int from labs) labs, (select count(*)::int from profiles) people',
    );
    expect(counts).toEqual({ labs: 3, people: 6 });

    const buckets = await rows<{ id: string; public: boolean }>(
      db,
      'select id, public from storage.buckets order by id',
    );
    expect(buckets).toEqual([
      { id: 'documents', public: false },
      { id: 'equipment-photos', public: true },
      { id: 'event-files', public: false },
    ]);
  });
});

describe('the server owns status (0009)', () => {
  let eq: string;
  beforeAll(async () => {
    eq = await machine(db, chem2, 'TEST-CHEM2-0101', 'TOKENSTATUS1');
  });

  it.each([
    ['status', `update equipment set status = 'faulty' where id = $1`],
    ['next_service_due', `update equipment set next_service_due = '2099-01-01' where id = $1`],
    ['last_service_at', `update equipment set last_service_at = current_date where id = $1`],
    ['retired_at', `update equipment set retired_at = now() where id = $1`],
    ['asset_id', `update equipment set asset_id = 'TEST-CHEM2-9999' where id = $1`],
  ])('refuses a technician writing %s directly', async (column, sql) => {
    await expect(asTech(() => db.query(sql, [eq]))).rejects.toThrow(`${column} cannot be changed directly`);
  });

  it('still lets a technician edit what they own', async () => {
    await asTech(() =>
      db.query(
        `update equipment set name = 'Renamed', location = 'Bench 9', label_printed_at = now(),
                photo_path = $1 || '/p.jpg' where id = $1::uuid`,
        [eq],
      ),
    );
    const [row] = await rows<{ name: string }>(db, 'select name from equipment where id = $1', [eq]);
    expect(row?.name).toBe('Renamed');
  });

  it('normalises server columns on registration instead of trusting them', async () => {
    const [row] = await asTech(() =>
      rows<{ status: string; next_service_due: string | null; created_by: string }>(
        db,
        `insert into equipment (lab_id, asset_id, qr_token, name, status, next_service_due, created_by)
         values ($1, 'TEST-CHEM2-0102', 'TOKENSMUGGLE', 'Smuggler', 'retired', '2099-01-01', $2)
         returning status, next_service_due, created_by`,
        [chem2, physTech],
      ),
    );
    expect(row).toEqual({ status: 'operational', next_service_due: null, created_by: tech });
  });

  it('still lets the server set them through an event', async () => {
    await asTech(() =>
      db.query(
        `insert into events (id, equipment_id, type, occurred_at, recorded_by, next_due_date)
         values (gen_random_uuid(), $1, 'maintenance', now(), $2, current_date + 90)`,
        [eq, tech],
      ),
    );
    const [row] = await rows<{ due: number }>(
      db,
      'select next_service_due - current_date as due from equipment where id = $1',
      [eq],
    );
    expect(row?.due).toBe(90);
  });

  it('keeps a technician out of another lab entirely', async () => {
    const result = await as(db, 'authenticated', physTech, () =>
      db.query(`update equipment set name = 'nope' where id = $1 returning id`, [eq]),
    );
    expect(result.rows).toHaveLength(0);
  });
});

describe('the service interval (0009)', () => {
  it('moves the next due date when it changes', async () => {
    const eq = await machine(db, chem2, 'TEST-CHEM2-0103', 'TOKENINTERVL', 100);
    await asTech(() =>
      db.query(
        `insert into events (id, equipment_id, type, occurred_at, recorded_by)
         values (gen_random_uuid(), $1, 'maintenance', now(), $2)`,
        [eq, tech],
      ),
    );
    const due = async () =>
      (
        await rows<{ d: number }>(
          db,
          'select next_service_due - current_date as d from equipment where id = $1',
          [eq],
        )
      )[0]?.d;

    expect(await due()).toBe(100);
    await asTech(() => db.query('update equipment set service_interval_days = 30 where id = $1', [eq]));
    expect(await due()).toBe(30);
  });
});

describe('the history is append-only', () => {
  it('refuses to edit or delete an event, even for its author', async () => {
    const eq = await machine(db, chem2, 'TEST-CHEM2-0104', 'TOKENHISTORY');
    const [ev] = await asTech(() =>
      rows<{ id: string }>(
        db,
        `insert into events (id, equipment_id, type, occurred_at, recorded_by)
         values (gen_random_uuid(), $1, 'use', now(), $2) returning id`,
        [eq, tech],
      ),
    );
    // As the owner, so the trigger is what refuses, not just a missing policy.
    await expect(db.query(`update events set type = 'fault' where id = $1`, [ev!.id])).rejects.toThrow(
      /append-only/,
    );
    await expect(db.query('delete from events where id = $1', [ev!.id])).rejects.toThrow(/append-only/);
  });

  it('refuses to change a printed QR token', async () => {
    const eq = await machine(db, chem2, 'TEST-CHEM2-0105', 'TOKENQRFIXED');
    await expect(
      db.query(`update equipment set qr_token = 'NEWTOKEN0000' where id = $1`, [eq]),
    ).rejects.toThrow(/permanent/);
  });
});

describe('documents (0009)', () => {
  let eq: string;
  let other: string;
  let doc: string;
  const path = () => `${eq}/start-up.pdf`;

  beforeAll(async () => {
    eq = await machine(db, chem2, 'TEST-CHEM2-0106', 'TOKENDOCSONE');
    other = await machine(db, chem2, 'TEST-CHEM2-0107', 'TOKENDOCSTWO');
  });

  it('lets a technician add an SOP, and records them as the uploader', async () => {
    const [row] = await asTech(() =>
      rows<{ id: string; uploaded_by: string }>(
        db,
        `insert into equipment_documents (equipment_id, kind, title, file_path)
         values ($1, 'sop', 'Start-up', $2) returning id, uploaded_by`,
        [eq, path()],
      ),
    );
    doc = row!.id;
    expect(row?.uploaded_by).toBe(tech);
  });

  it("refuses a file in another machine's folder", async () => {
    await expect(
      asTech(() =>
        db.query(
          `insert into equipment_documents (equipment_id, kind, title, file_path) values ($1, 'sop', 'x', $2)`,
          [eq, `${other}/x.pdf`],
        ),
      ),
    ).rejects.toThrow(/own_folder/);
  });

  it('shows the SOP to a visitor, and lets them open exactly that file', async () => {
    const [row] = await as(db, 'anon', null, () =>
      rows<{ open: boolean; docs: unknown[] }>(
        db,
        `select is_public_sop($1) as open, get_public_equipment('TOKENDOCSONE') -> 'documents' as docs`,
        [path()],
      ),
    );
    expect(row?.open).toBe(true);
    expect(row?.docs).toHaveLength(1);
  });

  it('never lets a published document be edited', async () => {
    await expect(
      asTech(() => db.query(`update equipment_documents set title = 'x' where id = $1`, [doc])),
    ).rejects.toThrow(/cannot be edited/);
  });

  it('withdraws it from the passport and from visitors, once', async () => {
    await asTech(() => db.query('update equipment_documents set withdrawn_at = now() where id = $1', [doc]));

    const [row] = await as(db, 'anon', null, () =>
      rows<{ open: boolean; docs: unknown[] }>(
        db,
        `select is_public_sop($1) as open, get_public_equipment('TOKENDOCSONE') -> 'documents' as docs`,
        [path()],
      ),
    );
    expect(row).toEqual({ open: false, docs: [] });

    const [who] = await rows<{ withdrawn_by: string }>(
      db,
      'select withdrawn_by from equipment_documents where id = $1',
      [doc],
    );
    expect(who?.withdrawn_by).toBe(tech);

    await expect(
      asTech(() => db.query('update equipment_documents set withdrawn_at = now() where id = $1', [doc])),
    ).rejects.toThrow(/already been withdrawn/);
  });
});

describe('replacement outcome still works with the guard in place (0008 + 0009)', () => {
  it('retires the machine when the outcome is Retired', async () => {
    const eq = await machine(db, chem2, 'TEST-CHEM2-0108', 'TOKENRETIRED');
    const evId = crypto.randomUUID();
    await asTech(async () => {
      await db.query(
        `insert into events (id, equipment_id, type, occurred_at, recorded_by) values ($1, $2, 'service_report', now(), $3)`,
        [evId, eq, tech],
      );
      await db.query(
        `insert into service_reports (event_id, vendor_company, service_date, work_done, recommendation)
         values ($1, 'Hallmark Scientific', current_date, 'Detector corroded', 'replace')`,
        [evId],
      );
    });
    expect(
      (await rows<{ status: string }>(db, 'select status from equipment where id = $1', [eq]))[0]?.status,
    ).toBe('replace');

    await asTech(() =>
      db.query(`update service_reports set outcome = 'retired' where event_id = $1`, [evId]),
    );
    const [row] = await rows<{ status: string; retired: boolean }>(
      db,
      'select status, retired_at is not null as retired from equipment where id = $1',
      [eq],
    );
    expect(row).toEqual({ status: 'retired', retired: true });
  });
});

describe('realtime (0009)', () => {
  it('publishes notifications so the alert bell is live', async () => {
    const [row] = await rows<{ n: number }>(
      db,
      `select count(*)::int as n from pg_publication_tables
       where pubname = 'supabase_realtime' and tablename = 'notifications'`,
    );
    expect(row?.n).toBe(1);
  });
});

describe('push on a shared phone (0009)', () => {
  const endpoint = 'https://push.example/endpoint-shared-phone';
  const keys = JSON.stringify({ p256dh: 'BKey', auth: 'AuthKey' });

  it('lets the next person on the device claim it, so alerts follow whoever holds the phone', async () => {
    await asTech(() =>
      db.query('select claim_push_subscription($1, $2::jsonb, $3)', [endpoint, keys, 'phone']),
    );
    // Session expired without signing out; a colleague signs in on the same phone.
    await as(db, 'authenticated', physTech, () =>
      db.query('select claim_push_subscription($1, $2::jsonb, $3)', [endpoint, keys, 'phone']),
    );
    const owners = await rows<{ profile_id: string }>(
      db,
      'select profile_id from push_subscriptions where endpoint = $1',
      [endpoint],
    );
    expect(owners).toEqual([{ profile_id: physTech }]);
  });

  it('refuses a visitor, and a subscription without keys', async () => {
    await expect(
      as(db, 'anon', null, () =>
        db.query('select claim_push_subscription($1, $2::jsonb, $3)', [endpoint, keys, 'x']),
      ),
    ).rejects.toThrow();
    await expect(
      asTech(() =>
        db.query(`select claim_push_subscription($1, '{}'::jsonb, 'x')`, ['https://push.example/nokeys']),
      ),
    ).rejects.toThrow(/p256dh and auth/);
  });

  it('still keeps people out of each other’s rows directly', async () => {
    const result = await asTech(() =>
      db.query('delete from push_subscriptions where endpoint = $1 returning id', [endpoint]),
    );
    expect(result.rows).toHaveLength(0);
  });
});

describe('initial service history at registration (spec 4.3)', () => {
  const statusOf = async (eq: string) =>
    (
      await rows<{ status: string; last: string | null; due_in: number | null }>(
        db,
        `select status, last_service_at::text as last, next_service_due - current_date as due_in
         from equipment where id = $1`,
        [eq],
      )
    )[0];

  it('a machine registered with no history has no due date, which is why the form asks', async () => {
    const eq = await machine(db, chem2, 'TEST-CHEM2-0201', 'TOKENNOHIST1', 180);
    expect(await statusOf(eq)).toEqual({ status: 'operational', last: null, due_in: null });
  });

  it('a last service 200 days ago on a 180-day interval makes it overdue straight away', async () => {
    const eq = await machine(db, chem2, 'TEST-CHEM2-0202', 'TOKENOVERDUE', 180);
    await asTech(() =>
      db.query(
        `insert into events (id, equipment_id, type, occurred_at, recorded_by, data)
         values (gen_random_uuid(), $1, 'maintenance', now() - interval '200 days', $2,
                 '{"summary":"Serviced before registration","initial":true}')`,
        [eq, tech],
      ),
    );
    expect(await statusOf(eq)).toMatchObject({ status: 'overdue', due_in: -20 });
  });

  it('a due date alone sets the date without pretending a service happened', async () => {
    const eq = await machine(db, chem2, 'TEST-CHEM2-0203', 'TOKENDUEONLY', 180);
    await asTech(() =>
      db.query(
        `insert into events (id, equipment_id, type, occurred_at, recorded_by, next_due_date, data)
         values (gen_random_uuid(), $1, 'status_change', now(), $2, current_date + 20,
                 '{"summary":"Next service date set at registration","initial":true}')`,
        [eq, tech],
      ),
    );
    expect(await statusOf(eq)).toEqual({ status: 'due_soon', last: null, due_in: 20 });
  });
});

describe('per-person alert settings (0010)', () => {
  let eq: string;
  let hod: string;
  let dean: string;
  let n = 0;

  beforeAll(async () => {
    eq = await machine(db, chem2, 'TEST-CHEM2-0301', 'TOKENALERTS1');
    hod = await userId(db, 'hod.chem@test.local');
    dean = await userId(db, 'dean@test.local');
  });

  /** Raise one alert and report what each person received on each channel. */
  async function raise(tier: string, template: string | null) {
    n += 1;
    const key = `test:${tier}:${n}`;
    await db.exec('delete from email_outbox; delete from push_outbox;');
    await db.query(`select queue_alert($1, $2::alert_tier, 'Title', 'Body', $3, $4, '{}'::jsonb)`, [
      eq,
      tier,
      key,
      template,
    ]);
    const got = async (who: string) => ({
      inApp: (await rows(db, 'select 1 from notifications where profile_id = $1 and dedupe_key = $2', [who, key])).length,
      push: (await rows(db, 'select 1 from push_outbox where profile_id = $1', [who])).length,
      email: (
        await rows(db, 'select 1 from email_outbox e join auth.users u on u.email = e.recipient where u.id = $1', [who])
      ).length,
    });
    return { tech: await got(tech), hod: await got(hod), dean: await got(dean) };
  }

  const setFor = (who: string, email: string, push: string, digest = false) =>
    as(db, 'authenticated', who, () =>
      db.query(
        `insert into notification_settings (profile_id, email, push, weekly_digest) values ($1, $2, $3, $4)
         on conflict (profile_id) do update set email = excluded.email, push = excluded.push,
           weekly_digest = excluded.weekly_digest, updated_at = now()`,
        [who, email, push, digest],
      ),
    );

  it('with no settings saved, lab staff get everything and leaders nothing, exactly as before', async () => {
    const r = await raise('warning', 'warning');
    expect(r.tech).toEqual({ inApp: 1, push: 1, email: 1 });
    expect(r.hod).toEqual({ inApp: 1, push: 1, email: 1 });
    expect(r.dean).toEqual({ inApp: 0, push: 0, email: 0 });
  });

  it('"critical only" email stops a warning email but keeps the in-app alert and push', async () => {
    await setFor(tech, 'critical', 'all');
    const warning = await raise('warning', 'warning');
    expect(warning.tech).toEqual({ inApp: 1, push: 1, email: 0 });
    const critical = await raise('critical_due', 'critical_due');
    expect(critical.tech).toEqual({ inApp: 1, push: 1, email: 1 });
  });

  it('turning both off never turns off the in-app record', async () => {
    await setFor(tech, 'none', 'none');
    const r = await raise('critical_fault', 'critical_fault');
    expect(r.tech).toEqual({ inApp: 1, push: 0, email: 0 });
  });

  it('a leader who opts in gets critical alerts across labs, and nothing below critical', async () => {
    await setFor(dean, 'critical', 'none');
    expect((await raise('critical_replacement', 'critical_replacement')).dean).toEqual({ inApp: 1, push: 0, email: 1 });
    expect((await raise('warning', 'warning')).dean).toEqual({ inApp: 0, push: 0, email: 0 });
  });

  it('tells the email template why this person is receiving it', async () => {
    await db.query('delete from email_outbox');
    await db.query(
      `select queue_alert($1, 'critical_due', 'T', 'B', 'test:reason', 'critical_due', '{}'::jsonb)`,
      [eq],
    );
    const reasons = await rows<{ reason: string }>(db, `select payload->>'reason' as reason from email_outbox order by 1`);
    expect(reasons.map((r) => r.reason)).toEqual(['lab', 'leader']);
  });

  it('reports defaults through my_alert_settings before anything is saved', async () => {
    const [mine] = await as(db, 'authenticated', hod, () => rows(db, 'select * from my_alert_settings()'));
    expect(mine).toEqual({ email: 'all', push: 'all', weekly_digest: false });
  });

  it("keeps everyone out of each other's settings", async () => {
    const result = await asTech(() =>
      db.query(`update notification_settings set email = 'all' where profile_id = $1 returning 1`, [dean]),
    );
    expect(result.rows).toHaveLength(0);
    await expect(
      asTech(() =>
        db.query(`insert into notification_settings (profile_id, email, push) values ($1, 'all', 'all')`, [hod]),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('weekly digest (0010)', () => {
  let dean: string;
  let hodPhy: string;

  beforeAll(async () => {
    dean = await userId(db, 'dean@test.local');
    hodPhy = await userId(db, 'hod.phy@test.local');
    const phy1 = await labId(db, 'PHY1');
    // One overdue machine in Physics; Chemistry already has overdue/retired ones from earlier tests.
    const eq = await machine(db, phy1, 'TEST-PHY1-0001', 'TOKENDIGEST1', 180);
    await db.query(
      `insert into events (id, equipment_id, type, occurred_at, recorded_by)
       values (gen_random_uuid(), $1, 'maintenance', now() - interval '400 days', $2)`,
      [eq, hodPhy],
    );
    for (const who of [dean, hodPhy]) {
      await as(db, 'authenticated', who, () =>
        db.query(
          `insert into notification_settings (profile_id, email, push, weekly_digest) values ($1, 'none', 'none', true)
           on conflict (profile_id) do update set weekly_digest = true`,
          [who],
        ),
      );
    }
    await db.query('delete from email_outbox');
  });

  const digestFor = async (who: string) =>
    (
      await rows<{ payload: { scope: string; items: { lab: string }[]; counts: Record<string, number> } }>(
        db,
        `select e.payload from email_outbox e join auth.users u on u.email = e.recipient
         where u.id = $1 and e.template = 'weekly_digest'`,
        [who],
      )
    ).map((r) => r.payload);

  it('goes to everyone who opted in, once a week however often the job runs', async () => {
    const [first] = await rows<{ n: number }>(db, 'select queue_weekly_digest() as n');
    const [second] = await rows<{ n: number }>(db, 'select queue_weekly_digest() as n');
    expect(first?.n).toBe(2);
    expect(second?.n).toBe(0);
    expect(await digestFor(dean)).toHaveLength(1);
  });

  it('shows the dean every lab, and a HOD only their own', async () => {
    const [deans] = await digestFor(dean);
    const [hods] = await digestFor(hodPhy);
    expect(deans?.scope).toBe('all');
    expect(new Set(deans?.items.map((i) => i.lab))).toEqual(new Set(['Chemistry Lab 2', 'Physics Lab 1']));
    expect(hods?.scope).toBe('own');
    expect(hods?.items.map((i) => i.lab)).toEqual(['Physics Lab 1']);
    expect(hods?.counts.overdue).toBe(1);
  });
});
