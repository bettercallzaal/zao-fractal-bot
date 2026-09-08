// Parses supabase/migrations/*.sql into a schema model a test fake can check
// writes against, so a mock cannot silently accept a payload the real
// database's CHECK constraints and NOT NULL columns would reject.
//
// This is a targeted line/regex parser, not a general SQL parser. It only
// understands the handful of statement shapes this repo's migrations
// actually use:
//   - create table if not exists public.<name> ( ... )
//   - alter table public.<t> add column if not exists <c> <type> ...
//   - an inline `check (<col> in ('a', 'b', ...))` on a column
//   - `alter table public.<t> add constraint <name> check (<col> in (...))`,
//     including one written as dynamic SQL inside a `do $$ ... $$` block via
//     `execute $tag$ ... $tag$` (0006_async_participation does exactly this
//     to widen discord_roster.confidence). Because this is a plain text scan
//     rather than a dollar-quote-aware parser, it sees straight through that
//     wrapping - which is the point: 0006 must win over 0002.
//
// Migrations are applied in filename order, and each later constraint change
// overwrites what came before for that (table, column) pair - so the model
// always reflects the *current* schema, not just the first thing seen.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface ColumnSchema {
  name: string;
  type: string;
  notNull: boolean;
  hasDefault: boolean;
  /** Allowed values from a CHECK (<col> in (...)) constraint, if any. */
  checkValues?: Set<string>;
}

export interface TableSchema {
  name: string;
  columns: Map<string, ColumnSchema>;
}

export interface SchemaModel {
  tables: Map<string, TableSchema>;
}

/**
 * Tables this repo's code writes to that are never `create table`-d by these
 * migrations - they live in the ZAO OS Supabase project (see
 * 0002_discord_roster.sql's header and 0005_respect_game.sql's comments).
 * assertWritable must SKIP these rather than guess at a schema for them:
 * 0005 does ALTER a couple of their columns in, but that is not enough to
 * validate a whole payload against.
 */
export const UNCOVERED_TABLES = [
  'fractal_sessions',
  'fractal_scores',
  'respect_members',
  'users',
] as const;

const TABLE_CONSTRAINT_KEYWORDS = new Set([
  'unique',
  'primary',
  'check',
  'foreign',
  'constraint',
  'exclude',
]);

// The first of these to appear in a column's remainder marks where its type
// text ends.
const COLUMN_STOP_WORDS = /\b(not\s+null|default|check|references|primary\s+key|unique)\b/i;

function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

function findMatchingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`schemaFromMigrations: unbalanced parentheses starting at index ${openIndex}`);
}

/** Splits a parenthesized column-list body on top-level commas only - a
 * comma nested inside `check (col in (a, b, c))` or a type's own parens must
 * not split the list. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

function parseInlineCheck(segment: string): { column: string; values: Set<string> } | null {
  const m = segment.match(/check\s*\(\s*(\w+)\s+in\s*\(([^)]+)\)\s*\)/i);
  if (!m) return null;
  return { column: m[1], values: valuesFromList(m[2]) };
}

function valuesFromList(list: string): Set<string> {
  return new Set(
    list
      .split(',')
      .map((v) => v.trim().replace(/^'|'$/g, ''))
      .filter((v) => v.length > 0),
  );
}

function parseColumnSegment(segment: string): ColumnSchema | null {
  const nameMatch = segment.match(/^(\w+)\s+([\s\S]+)$/);
  if (!nameMatch) return null;
  const [, name, rest] = nameMatch;
  if (TABLE_CONSTRAINT_KEYWORDS.has(name.toLowerCase())) return null;

  const stopAt = rest.search(COLUMN_STOP_WORDS);
  const type = (stopAt === -1 ? rest : rest.slice(0, stopAt)).trim();
  // Postgres makes every primary key column NOT NULL implicitly, whether or
  // not the migration also spells out `not null` - `bot_name text primary
  // key` (0003_awareness.sql) never says "not null" but is exactly as
  // required as if it did.
  const notNull = /not\s+null/i.test(rest) || /\bprimary\s+key\b/i.test(rest);
  const hasDefault = /\bdefault\b/i.test(rest);
  const inlineCheck = parseInlineCheck(segment);

  return {
    name,
    type,
    notNull,
    hasDefault,
    checkValues: inlineCheck && inlineCheck.column === name ? inlineCheck.values : undefined,
  };
}

// Only `check (<col> in (<list>))` is understood. A CHECK written any other
// way (a range like `check (level between 1 and 6)`, `check (col = ANY(...))`,
// a multi-column expression, ...) must not be silently treated as "no
// constraint" - that is the same "mock that accepts anything" failure this
// whole guard exists to prevent, just moved one level down from "any
// payload" to "any CHECK shape the parser happens to recognise". So this
// scans every `check (...)` in a migration - inline column checks, ALTER ...
// ADD CONSTRAINT ... CHECK, and anything inside a `do $$ ... $$` block, since
// it works on raw text rather than a dollar-quote-aware parser - and throws
// the moment one doesn't fit the recognised shape, naming the migration file
// and the offending fragment so the gap is a red test, not a silent one.
function assertOnlyKnownCheckShapes(sql: string, fileLabel: string): void {
  const re = /\bcheck\b\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = findMatchingParen(sql, openIndex);
    const inner = sql.slice(openIndex + 1, closeIndex);
    if (!/^\s*\w+\s+in\s*\([^()]*\)\s*$/i.test(inner)) {
      throw new Error(
        `schemaFromMigrations: ${fileLabel} has a CHECK constraint this parser does not ` +
          `recognise: check (${inner.trim()}). Only "check (<col> in (<list>))" is understood - ` +
          `teach assertOnlyKnownCheckShapes/parseInlineCheck this shape before assertWritable can ` +
          `be trusted to enforce it. Silently leaving the column unconstrained would recreate the ` +
          `exact "mock that accepts anything" bug this guard exists to catch.`,
      );
    }
  }
}

function applyCreateTables(sql: string, model: SchemaModel): void {
  const re = /create table if not exists public\.(\w+)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    const tableName = match[1];
    const openIndex = match.index + match[0].length - 1;
    const closeIndex = findMatchingParen(sql, openIndex);
    const body = sql.slice(openIndex + 1, closeIndex);

    const columns = new Map<string, ColumnSchema>();
    for (const segment of splitTopLevel(body)) {
      const col = parseColumnSegment(segment);
      if (col) columns.set(col.name, col);
    }
    model.tables.set(tableName, { name: tableName, columns });
  }
}

function applyAddColumns(sql: string, model: SchemaModel): void {
  const re = /alter table public\.(\w+)\s+add column if not exists\s+(\w+)\s+([^;]*);/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    const [, tableName, colName, rest] = match;
    const table = model.tables.get(tableName);
    // A table these migrations never `create table`-d (e.g. fractal_sessions,
    // owned by ZAO OS) stays uncovered rather than being half-guessed from a
    // single ALTER. See UNCOVERED_TABLES.
    if (!table) continue;

    const stopAt = rest.search(COLUMN_STOP_WORDS);
    const type = (stopAt === -1 ? rest : rest.slice(0, stopAt)).trim();
    table.columns.set(colName, {
      name: colName,
      type,
      notNull: /not\s+null/i.test(rest) || /\bprimary\s+key\b/i.test(rest),
      hasDefault: /\bdefault\b/i.test(rest),
    });
  }
}

function applyAddedChecks(sql: string, model: SchemaModel): void {
  // Matches a plain `alter table ... add constraint ... check (col in (...))`
  // AND the same text sitting inside `execute $c1$ ... $c1$` inside a
  // `do $$ ... $$` block - this is a text scan, not a dollar-quote-aware
  // parser, so the wrapping is invisible to it. That is exactly what lets
  // 0006's widened discord_roster.confidence check win over 0002's.
  const re =
    /alter\s+table\s+public\.(\w+)\s+add\s+constraint\s+\w+\s+check\s*\(\s*(\w+)\s+in\s*\(([^)]+)\)\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    const [, tableName, colName, valuesText] = match;
    const table = model.tables.get(tableName);
    if (!table) continue;
    const col = table.columns.get(colName);
    if (!col) continue;
    col.checkValues = valuesFromList(valuesText);
  }
}

/** Builds a schema model from raw migration SQL, applied in the given order.
 * Later constraint changes win over earlier ones for the same column - this
 * is what lets a test build "schema as of migration N" by passing a prefix
 * of the full list.
 *
 * `fileLabels`, if given, names each entry of `sqlTexts` for error messages
 * (an unrecognised CHECK shape names the file it came from). Defaults to a
 * positional label when omitted, since most callers only have the text. */
export function parseMigrations(sqlTexts: string[], fileLabels: string[] = []): SchemaModel {
  const model: SchemaModel = { tables: new Map() };
  sqlTexts.forEach((raw, i) => {
    const label = fileLabels[i] ?? `migration[${i}]`;
    const sql = stripLineComments(raw);
    assertOnlyKnownCheckShapes(sql, label);
    applyCreateTables(sql, model);
    applyAddColumns(sql, model);
    applyAddedChecks(sql, model);
  });
  return model;
}

/** Builds the schema model from every *.sql file in migrationsDir, applied
 * in filename order (the same order Supabase applies them in). */
export function buildSchema(migrationsDir = 'supabase/migrations'): SchemaModel {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const sqlTexts = files.map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'));
  return parseMigrations(sqlTexts, files);
}
