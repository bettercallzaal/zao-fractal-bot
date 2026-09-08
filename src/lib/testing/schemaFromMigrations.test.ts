import { describe, expect, it } from 'vitest';
import { assertWritable } from './assertWritable.js';
import {
  buildSchema,
  loadZaoosSchema,
  parseMigrations,
  pendingMigrationColumns,
  PARTIALLY_COVERED_TABLES,
} from './schemaFromMigrations.js';

describe('unparseable CHECK constraints fail loudly rather than being silently skipped', () => {
  // A guard that silently ignores a CHECK shape it cannot parse is worse than
  // no guard - it reads as coverage while actually leaving the column
  // unconstrained forever. Every CHECK in today's real migrations happens to
  // be `check (<col> in (<list>))`; this proves a future migration that uses
  // a different shape (range, ANY(ARRAY[...]), etc.) cannot slip through
  // unnoticed the way 0002's narrow confidence check almost did.

  const badMigration = `
    create table if not exists public.some_table (
      id uuid primary key default gen_random_uuid(),
      level integer not null check (level between 1 and 6)
    );
  `;

  it('throws at schema-build time, naming the migration file', () => {
    expect(() => parseMigrations([badMigration], ['0099_bad_check.sql'])).toThrow(
      /0099_bad_check\.sql/,
    );
  });

  it('names the offending fragment in the message', () => {
    expect(() => parseMigrations([badMigration], ['0099_bad_check.sql'])).toThrow(
      /level between 1 and 6/,
    );
  });

  it('does not false-positive on a CHECK inside a line comment', () => {
    const sql = `
      -- an example: check (level between 1 and 6) is NOT how we do it here
      create table if not exists public.some_table (
        id uuid primary key default gen_random_uuid(),
        status text not null default 'pending'
          check (status in ('pending', 'done'))
      );
    `;
    expect(() => parseMigrations([sql], ['0099_commented.sql'])).not.toThrow();
  });

  it('does not false-positive on the drop-constraint half of a do $$ block', () => {
    // Mirrors 0006_async_participation.sql's shape: a DO block that first
    // drops a constraint by lookup (no CHECK text at all in that half), then
    // adds a well-formed IN-list check via dynamic SQL.
    const sql = `
      create table if not exists public.some_table (
        id uuid primary key default gen_random_uuid(),
        confidence text not null check (confidence in ('a', 'b'))
      );

      do $$
      declare c record;
      begin
        for c in
          select con.conname
          from pg_constraint con
          join pg_class rel on rel.oid = con.conrelid
          where con.contype = 'c'
        loop
          execute format('alter table public.some_table drop constraint %I', c.conname);
        end loop;

        execute $c1$
          alter table public.some_table
            add constraint some_table_confidence_check
            check (confidence in ('a', 'b', 'c'))
        $c1$;
      end $$;
    `;
    const schema = parseMigrations([sql], ['0099_do_block.sql']);
    expect(schema.tables.get('some_table')?.columns.get('confidence')?.checkValues).toEqual(
      new Set(['a', 'b', 'c']),
    );
  });

  it('does not false-positive on a CHECK inside a block comment', () => {
    // No current migration uses /* ... */ (0006 documents itself with `--`
    // blocks), but nothing stops a future author from preferring it - and an
    // illustrative, unparseable `check (...)` inside one must not take down
    // buildSchema() for every test file in the repo. Only `--` line comments
    // were stripped before this test; block comments were not.
    const sql = `
      /* example: check (level between 1 and 6) is NOT how we do it here -
         multi-line block comment, deliberately spanning several lines. */
      create table if not exists public.some_table (
        id uuid primary key default gen_random_uuid(),
        status text not null default 'pending'
          check (status in ('pending', 'done'))
      );
    `;
    expect(() => parseMigrations([sql], ['0099_block_commented.sql'])).not.toThrow();
  });

  it('the real migration set still builds clean', () => {
    expect(() => buildSchema()).not.toThrow();
  });
});

describe('an "alter table ... add column" without the literal "if not exists" fails loudly', () => {
  // iterAddColumnStatements only recognises `add column if not exists`. A
  // migration that writes ordinary, valid Postgres - `add column b text;`,
  // with no "if not exists" - never enters that regex, so the column never
  // joins the model and assertWritable rejects a correct payload as an
  // unknown column, blaming the payload for a parser gap. Failing at parse
  // time, naming the migration and the fragment, turns that into a clear
  // "teach the parser this shape" signal instead of a wrong accusation.
  const sql = `
    create table if not exists public.some_table (
      id uuid primary key default gen_random_uuid()
    );

    alter table public.some_table add column b text;
  `;

  it('throws at schema-build time, naming the migration file', () => {
    expect(() => parseMigrations([sql], ['0099_bare_add_column.sql'])).toThrow(
      /0099_bare_add_column\.sql/,
    );
  });

  it('names the offending fragment in the message', () => {
    expect(() => parseMigrations([sql], ['0099_bare_add_column.sql'])).toThrow(
      /add column b/,
    );
  });

  it('does not false-positive on the real, correctly-spelled shape', () => {
    const good = `
      create table if not exists public.some_table (
        id uuid primary key default gen_random_uuid()
      );

      alter table public.some_table add column if not exists b text;
    `;
    expect(() => parseMigrations([good], ['0099_good.sql'])).not.toThrow();
  });
});

describe('a "create table if not exists" that re-declares an already-modeled table fails loudly', () => {
  // applyCreateTables replaces a table's column model wholesale. A LATER
  // migration that re-declares a table this parser already has a model for
  // (created earlier, or altered since) would silently drop any column an
  // earlier ALTER added - e.g. a future re-declaration of discord_roster
  // that omits is_async (added by 0006) would make createSession's correct
  // insert look like it uses an unknown column. Throwing at parse time turns
  // that into a clear signal instead of a wrong accusation against a correct
  // payload.
  const sql = `
    create table if not exists public.discord_roster (
      session_id uuid not null
    );

    alter table public.discord_roster add column if not exists is_async boolean not null default false;

    create table if not exists public.discord_roster (
      session_id uuid not null
    );
  `;

  it('throws at schema-build time, naming the migration file', () => {
    expect(() => parseMigrations([sql], ['0099_redeclared_table.sql'])).toThrow(
      /0099_redeclared_table\.sql/,
    );
  });

  it('names the re-declared table in the message', () => {
    expect(() => parseMigrations([sql], ['0099_redeclared_table.sql'])).toThrow(
      /discord_roster/,
    );
  });

  it('names applyCreateTables as the function to extend', () => {
    expect(() => parseMigrations([sql], ['0099_redeclared_table.sql'])).toThrow(
      /applyCreateTables/,
    );
  });
});

describe('a table-level named CHECK constraint inside a create table body is enforced', () => {
  // `constraint <name> check (<col> in (<list>))` written INSIDE a
  // `create table ( ... )` body (as opposed to a later `alter table ... add
  // constraint`) is a recognised shape - assertOnlyKnownCheckShapes does not
  // throw on it - but until this fix, nothing ever attached its values to
  // the column. The result was a CHECK that parsed, didn't throw, and
  // constrained nothing: the original "silently unconstrained" failure in a
  // shape the first fix didn't cover.
  const sql = `
    create table if not exists public.t (
      id uuid primary key default gen_random_uuid(),
      status text,
      constraint t_status_check check (status in ('a','b'))
    );
  `;

  it('attaches the CHECK values to the named column', () => {
    const schema = parseMigrations([sql]);
    expect(schema.tables.get('t')?.columns.get('status')?.checkValues).toEqual(
      new Set(['a', 'b']),
    );
  });

  it('is actually enforced by assertWritable - a value outside the list is rejected', () => {
    const schema = parseMigrations([sql]);
    expect(() => assertWritable('t', { status: 'c' }, schema)).toThrow(/status/);
  });

  it('and a value inside the list passes', () => {
    const schema = parseMigrations([sql]);
    expect(() => assertWritable('t', { status: 'a' }, schema)).not.toThrow();
  });
});

describe('a CHECK list that merely contains the word "default" does not disable the not-null rule', () => {
  // hasDefault used to search the whole column-definition text for the bare
  // word "default" - which also matches a CHECK-list value literally named
  // 'default', e.g. `check (status in ('default','other'))`. That is a false
  // negative in the one rule (not-null-no-default on insert) with no other
  // backstop: a column with no real DEFAULT clause would be treated as
  // having one and silently stop being required.
  const sql = `
    create table if not exists public.some_table (
      status text not null check (status in ('default','other'))
    );
  `;

  it('does not treat the CHECK list as a DEFAULT clause', () => {
    const schema = parseMigrations([sql]);
    const col = schema.tables.get('some_table')?.columns.get('status');
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(false);
  });

  it('is still required on insert - not silently satisfied by a phantom default', () => {
    const schema = parseMigrations([sql]);
    expect(() => assertWritable('some_table', {}, schema, 'insert')).toThrow(/status/);
  });

  it('a real DEFAULT clause is still recognised', () => {
    const withRealDefault = `
      create table if not exists public.some_table (
        status text not null default 'default' check (status in ('default','other'))
      );
    `;
    const schema = parseMigrations([withRealDefault]);
    const col = schema.tables.get('some_table')?.columns.get('status');
    expect(col?.hasDefault).toBe(true);
  });
});

describe('a `primary key` column implies NOT NULL, as Postgres does', () => {
  it('a primary key with no default is required on insert', () => {
    const sql = `
      create table if not exists public.some_table (
        bot_name text primary key,
        status text not null default 'up'
      );
    `;
    const schema = parseMigrations([sql]);
    const col = schema.tables.get('some_table')?.columns.get('bot_name');
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(false);
  });

  it('a primary key WITH a default is not required on insert - the default supplies it', () => {
    const sql = `
      create table if not exists public.some_table (
        id uuid primary key default gen_random_uuid(),
        status text not null default 'up'
      );
    `;
    const schema = parseMigrations([sql]);
    const col = schema.tables.get('some_table')?.columns.get('id');
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
  });

  it('discord_bot_heartbeats.bot_name (0003, real migration) is required on insert', () => {
    // 0003_awareness.sql:19 - `bot_name text primary key` with no `not null`
    // token and no default. Before this fix it parsed as notNull: false, a
    // live false-negative now that heartbeat.test.ts guards real writes.
    const schema = buildSchema();
    const col = schema.tables.get('discord_bot_heartbeats')?.columns.get('bot_name');
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(false);
  });
});

describe('the ZAO OS fixture closes the four uncovered tables to column-existence only', () => {
  // fractal_sessions, fractal_scores, users, respect_members live in the ZAO
  // OS project and are never `create table`-d by these migrations. buildSchema()
  // merges in src/lib/testing/zaoos-schema.json (a snapshot taken by
  // scripts/refresh-zaoos-schema.mjs) so a write to any of them is at least
  // checked for an unknown column - the same exposure that let createSession's
  // `confidence: 'manual'` insert ship, just on a table this repo cannot
  // introspect from its own migrations.
  const schema = buildSchema();

  it('is present for all four PARTIALLY_COVERED_TABLES', () => {
    for (const table of PARTIALLY_COVERED_TABLES) {
      expect(schema.tables.has(table)).toBe(true);
    }
  });

  it('knows fractal_scores.member_name is real and fractal_scores.nonsense_column is not', () => {
    const fractalScores = schema.tables.get('fractal_scores');
    expect(fractalScores?.columns.has('member_name')).toBe(true);
    expect(fractalScores?.columns.has('nonsense_column')).toBe(false);
  });

  it('unions in columns this repo\'s own migrations add to a partially-covered table', () => {
    // 0005_respect_game.sql ALTERs fractal_sessions to add meeting_number.
    // The live ZAO OS snapshot doesn't have it (those migrations have never
    // been applied there - a deployment gap, not a code defect), but
    // createSession writes exactly this column, on purpose, because it is
    // the column its own migration defines. The known-columns set for a
    // partially-covered table must be the UNION of the snapshot and what
    // this repo's migrations define for it - not the snapshot alone.
    expect(schema.tables.get('fractal_sessions')?.columns.has('meeting_number')).toBe(true);
    expect(() =>
      assertWritable('fractal_sessions', { status: 'active', meeting_number: 111 }, schema),
    ).not.toThrow();
  });

  it('still rejects a genuine typo - union, not disabled unknown-column detection', () => {
    expect(() =>
      assertWritable('fractal_sessions', { meetingnumber: 111 }, schema),
    ).toThrow(/meetingnumber/);
  });

  it('carries NO not-null or CHECK information for these tables - column existence only', () => {
    // This is the boundary PARTIALLY_COVERED_TABLES documents: PostgREST's
    // schema description conflates real not-null columns with every
    // auto-generated primary key in its `required` array, and does not expose
    // CHECK constraints at all - so neither is trustworthy enough to enforce.
    // See scripts/refresh-zaoos-schema.mjs for the fractal_scores.id example
    // that makes demanding `required` columns on insert actively wrong.
    for (const table of PARTIALLY_COVERED_TABLES) {
      for (const column of schema.tables.get(table)!.columns.values()) {
        expect(column.notNull).toBe(false);
        expect(column.checkValues).toBeUndefined();
      }
    }
  });
});

describe('pendingMigrationColumns - drift information, not a failure', () => {
  // Once the union lands, a partially-covered table's own pending migration
  // columns no longer make gameRepo.test.ts red - that would misrepresent a
  // tracked deployment gap as a code defect. But the fact itself (this
  // repo's migrations define columns ZAO OS's live database doesn't have
  // yet) is real and worth stating plainly, so pendingMigrationColumns()
  // reports it instead of hiding it.
  it('reports whatever it finds, without asserting a specific column stays pending', () => {
    // fractal_sessions.meeting_number is pending ONLY because this repo's
    // migrations have never been applied to the live ZAO OS database - the
    // single open blocker for this whole project. The moment someone applies
    // 0005 and refreshes the snapshot, this list becomes []. Hard-coding
    // today's pending column here means the person who does the CORRECT
    // thing (applies the migration, refreshes the fixture) gets a red suite
    // - an arrayContaining diff against an empty array - that explains
    // nothing. pendingMigrationColumns' own doc comment says a test
    // surfacing this list "should report what it finds, not throw", so this
    // asserts only the shape (must pass whether the list is empty or not)
    // and reports the contents via console.info, the same pattern
    // tableCoverage.test.ts uses for its own visibility-not-enforcement
    // check.
    const pending = pendingMigrationColumns();
    expect(Array.isArray(pending)).toBe(true);
    for (const item of pending) {
      expect(item).toEqual(
        expect.objectContaining({ table: expect.any(String), column: expect.any(String) }),
      );
    }
    // eslint-disable-next-line no-console
    console.info(
      `pendingMigrationColumns: ${pending.length} column(s) pending ` +
        `(${pending.map((p) => `${p.table}.${p.column}`).sort().join(', ') || 'none'})`,
    );
  });

  it('never reports a column the live snapshot already has', () => {
    const pending = pendingMigrationColumns();
    for (const { table, column } of pending) {
      const fixture = loadZaoosSchema();
      expect(fixture.tables[table]?.columns[column]).toBeUndefined();
    }
  });
});

describe('zaoos-schema.json must be re-verified before it goes stale', () => {
  // A time-bound claim nobody re-checks is exactly the failure this whole
  // exercise exists to close - so this test, not a comment or a calendar
  // reminder, is what forces the re-check to actually happen.
  it('fails once provenance.recheckBy has passed, naming the refresh script', () => {
    const { provenance } = loadZaoosSchema();
    const recheckBy = new Date(`${provenance.recheckBy}T00:00:00Z`);
    const now = new Date();
    if (now.getTime() > recheckBy.getTime()) {
      throw new Error(
        `src/lib/testing/zaoos-schema.json is stale: its recheckBy date ` +
          `(${provenance.recheckBy}) has passed. Re-run ` +
          `scripts/refresh-zaoos-schema.mjs against the ZAO OS project and commit ` +
          `the refreshed fixture. That script needs ZAO OS credentials ` +
          `(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) - if you don't have them, this is not ` +
          `something you can clear yourself; hand it to someone who does.`,
      );
    }
  });
});
