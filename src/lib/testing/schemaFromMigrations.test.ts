import { describe, expect, it } from 'vitest';
import {
  buildSchema,
  loadZaoosSchema,
  parseMigrations,
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

  it('the real migration set still builds clean', () => {
    expect(() => buildSchema()).not.toThrow();
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
          `the refreshed fixture.`,
      );
    }
    expect(now.getTime()).toBeLessThanOrEqual(recheckBy.getTime());
  });
});
