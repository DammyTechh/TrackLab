// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { migrated, rows, type Db } from './harness';

/**
 * This repository's OWN institution seeds (0005, 0006), whichever institution
 * that is. The rule tests use fixed test data instead; this checks that the
 * real seeds would give a working deployment.
 */

const envDir = join(__dirname, '../../deploy/env');

/** The VITE_ values in an env template, with dotenv quoting removed. */
function readEnv(file: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of readFileSync(join(envDir, file), 'utf8').split('\n')) {
    const m = line.match(/^(VITE_[A-Z_]+)=(.*)$/);
    if (m) env[m[1]!] = m[2]!.trim().replace(/^"(.*)"$/, '$1');
  }
  return env;
}

let db: Db;
beforeAll(async () => {
  db = await migrated({ seeds: true });
}, 60_000);

describe("this institution's seeds", () => {
  it('create exactly one institution', async () => {
    expect(await rows(db, 'select 1 from institution')).toHaveLength(1);
  });

  it('match the website settings, so emails and screens use the same name and colours', async () => {
    const [inst] = await rows<{ code: string; product_name: string; brand_primary: string; brand_accent: string }>(
      db,
      'select code, product_name, brand_primary, brand_accent from institution',
    );
    const templates = readdirSync(envDir)
      .filter((f) => /^\.env\..+\.example$/.test(f))
      .map((f) => ({ file: f, env: readEnv(f) }))
      .filter((t) => t.env.VITE_INSTITUTION_CODE === inst!.code);

    expect(templates.map((t) => t.file), `one deploy/env template for ${inst!.code}`).toHaveLength(1);
    const env = templates[0]!.env;
    expect(env.VITE_PRODUCT_NAME).toBe(inst!.product_name);
    expect(env.VITE_BRAND_PRIMARY?.toLowerCase()).toBe(inst!.brand_primary.toLowerCase());
    expect(env.VITE_BRAND_ACCENT?.toLowerCase()).toBe(inst!.brand_accent.toLowerCase());
  });

  it('create labs with short codes that can go into an asset ID', async () => {
    const labs = await rows<{ code: string }>(db, 'select code from labs');
    expect(labs.length).toBeGreaterThan(0);
    for (const lab of labs) expect(lab.code).toMatch(/^[A-Z0-9]{2,10}$/);
  });

  it('create accounts that can actually sign in, and must change their password first', async () => {
    const people = await rows<{ email: string; has_identity: boolean; must_change: boolean }>(
      db,
      `select u.email, exists (select 1 from auth.identities i where i.user_id = u.id) as has_identity,
              p.must_change_password as must_change
       from profiles p join auth.users u on u.id = p.id`,
    );
    expect(people.length).toBeGreaterThan(0);
    for (const person of people) {
      expect(person.has_identity, `${person.email} has no auth identity, so cannot sign in`).toBe(true);
      expect(person.must_change, `${person.email} is not forced to change the seeded password`).toBe(true);
    }
  });

  it('include an administrator, and put every technician and HOD in at least one lab', async () => {
    const [admins] = await rows<{ n: number }>(db, `select count(*)::int as n from profiles where role = 'admin'`);
    expect(admins!.n).toBeGreaterThan(0);
    const labless = await rows<{ email: string }>(
      db,
      `select u.email from profiles p join auth.users u on u.id = p.id
       where p.role in ('technician', 'lab_hod')
         and not exists (select 1 from lab_members m where m.profile_id = p.id)`,
    );
    expect(labless, 'technicians and HODs with no lab can do nothing').toEqual([]);
  });
});
