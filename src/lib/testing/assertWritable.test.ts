import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertWritable } from './assertWritable.js';
import { buildSchema, parseMigrations, PARTIALLY_COVERED_TABLES } from './schemaFromMigrations.js';

const migration = (name: string) =>
  readFileSync(`supabase/migrations/${name}.sql`, 'utf8');

describe('schema built from 0002 alone', () => {
  // This is the historical bug: createSession wrote confidence: 'manual' into
  // discord_roster, but 0002's CHECK constraint only permits
  // ('registry','exact','fuzzy','ambiguous','none'). The insert would have
  // failed with a check violation, and /start could never record a fractal.
  const schema0002 = parseMigrations([migration('0002_discord_roster')]);

  it('rejects confidence: manual - the value 0002 does not permit', () => {
    try {
      assertWritable(
        'discord_roster',
        { display_name: 'x', confidence: 'manual' },
        schema0002,
      );
      throw new Error('expected assertWritable to throw');
    } catch (err) {
      const message = (err as Error).message;
      for (const allowed of ['registry', 'exact', 'fuzzy', 'ambiguous', 'none']) {
        expect(message).toContain(allowed);
      }
    }
  });

  it('names the table, column and offending value in the message', () => {
    try {
      assertWritable(
        'discord_roster',
        { display_name: 'x', confidence: 'manual' },
        schema0002,
      );
      throw new Error('expected assertWritable to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('discord_roster');
      expect(message).toContain('confidence');
      expect(message).toContain('manual');
    }
  });
});

describe('schema built from the full migration set', () => {
  // 0006_async_participation drops and re-adds the discord_roster.confidence
  // CHECK with a wider set, inside a `do $$ ... $$` block using
  // `execute $c1$ ... $c1$`. If the parser only takes the first match (0002's
  // definition) this test fails.
  const schema = buildSchema();

  it('allows confidence: manual once 0006 has applied', () => {
    expect(() =>
      assertWritable(
        'discord_roster',
        { display_name: 'x', confidence: 'manual' },
        schema,
      ),
    ).not.toThrow();
  });

  it('rejects an unknown column', () => {
    expect(() =>
      assertWritable(
        'discord_roster',
        { display_name: 'x', confidence: 'manual', not_a_real_column: 1 },
        schema,
      ),
    ).toThrow(/not_a_real_column/);
  });

  it('rejects a missing not-null-no-default column on insert', () => {
    // display_name is `not null` with no default on discord_roster.
    expect(() =>
      assertWritable('discord_roster', { confidence: 'manual' }, schema, 'insert'),
    ).toThrow(/display_name/);
  });

  it('does not require that same column on update - update payloads are partial', () => {
    expect(() =>
      assertWritable('discord_roster', { confidence: 'manual' }, schema, 'update'),
    ).not.toThrow();
  });

  it('rejects an explicit `{ col: undefined }` on insert the same as a missing key', () => {
    // The not-null-presence check used `in`, which is true for a key whose
    // value is explicitly `undefined` - but supabase-js drops `undefined`
    // keys before serialising a payload, so Postgres sees the column
    // omitted entirely and rejects the real insert. A fake that lets
    // `{ display_name: undefined }` through is exactly as wrong as one that
    // lets a genuinely missing key through.
    expect(() =>
      assertWritable(
        'discord_roster',
        { display_name: undefined, confidence: 'manual' },
        schema,
        'insert',
      ),
    ).toThrow(/display_name/);
  });

  it('lists the four tables the migrations cannot see, so the gap is stated, not silent', () => {
    expect(PARTIALLY_COVERED_TABLES).toEqual(
      expect.arrayContaining(['fractal_sessions', 'fractal_scores', 'respect_members', 'users']),
    );
  });
});

describe('a PARTIALLY_COVERED_TABLES table - schema comes from the ZAO OS fixture, not a migration', () => {
  // fractal_sessions lives in the ZAO OS project. These migrations only ever
  // ALTER it (0005 adds meeting_number); they never CREATE it. buildSchema()
  // fills the gap from src/lib/testing/zaoos-schema.json (see
  // scripts/refresh-zaoos-schema.mjs), so this table is no longer skipped -
  // it is checked for unknown columns, same as any table the migrations do
  // create.
  const schema = buildSchema();

  it('rejects a column that is not real on the live table', () => {
    expect(() =>
      assertWritable('fractal_sessions', { status: 'active', not_a_real_column: 1 }, schema),
    ).toThrow(/not_a_real_column/);
  });

  it('accepts a payload using only real columns', () => {
    expect(() =>
      assertWritable(
        'fractal_sessions',
        { status: 'active', thread_id: 't1', guild_id: 'g1' },
        schema,
      ),
    ).not.toThrow();
  });

  it('does NOT enforce not-null on insert - not even the primary key', () => {
    // fractal_scores.required is ['id','member_name','score'] per PostgREST,
    // and `id` is an auto-generated primary key - never supplied on insert.
    // If this guard demanded it, completeSession's real (correct) insert
    // would be rejected. See scripts/refresh-zaoos-schema.mjs.
    expect(() =>
      assertWritable('fractal_scores', { member_name: 'x' }, schema, 'insert'),
    ).not.toThrow();
  });

  it('does NOT enforce CHECK constraints - PostgREST does not expose them here', () => {
    // No CHECK values are known for any partially-covered table, so any value
    // for any real column passes - this is the explicit, stated boundary of
    // "column existence only", not an oversight.
    expect(() =>
      assertWritable('fractal_sessions', { status: 'not-a-real-status-value' }, schema),
    ).not.toThrow();
  });

  it('an unknown-column rejection on this table points at the snapshot, not just the payload', () => {
    // For the 9 migration-defined tables, an unknown column really does mean
    // the payload is wrong - the migrations are in this repo. For a
    // PARTIALLY_COVERED_TABLES table the likelier cause is the reverse: the
    // checked-in ZAO OS snapshot is stale against a database this repo does
    // not own. The message must say so and name the refresh script, the same
    // treatment tableCoverage.test.ts's own unknown-table message gets.
    try {
      assertWritable('fractal_sessions', { not_a_real_column: 1 }, schema);
      throw new Error('expected assertWritable to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('not_a_real_column');
      expect(message).toContain('refresh-zaoos-schema.mjs');
      expect(message).toContain('stale');
    }
  });
});
