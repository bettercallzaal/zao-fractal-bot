import { describe, expect, it } from 'vitest';
import { buildSchema, parseMigrations } from './schemaFromMigrations.js';

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
