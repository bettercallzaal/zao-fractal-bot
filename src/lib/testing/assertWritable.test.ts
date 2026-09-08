import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertWritable } from './assertWritable.js';
import { buildSchema, parseMigrations, UNCOVERED_TABLES } from './schemaFromMigrations.js';

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

  it('skips a table these migrations do not define, rather than guessing at it', () => {
    // fractal_sessions lives in the ZAO OS project. These migrations only
    // ever ALTER it (0005 adds meeting_number); they never CREATE it.
    expect(() =>
      assertWritable('fractal_sessions', { anything: 'goes', confidence: 'not-checked' }, schema),
    ).not.toThrow();
  });

  it('lists the tables it cannot cover, so the gap is visible', () => {
    expect(UNCOVERED_TABLES).toEqual(
      expect.arrayContaining(['fractal_sessions', 'fractal_scores', 'respect_members', 'users']),
    );
    for (const table of UNCOVERED_TABLES) {
      expect(schema.tables.has(table)).toBe(false);
    }
  });
});
