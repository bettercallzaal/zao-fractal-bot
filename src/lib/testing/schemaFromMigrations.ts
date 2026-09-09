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
import { fileURLToPath } from 'node:url';

// Default paths below are resolved relative to *this file's own location*,
// not process.cwd(). A caller running from the repo root and one running
// from a different npm workspace (e.g. `npm test -w web`, whose cwd is
// web/) must get the same schema - cwd-relative defaults ('supabase/
// migrations') would silently resolve to `web/supabase/migrations` (which
// doesn't exist) the moment this module is imported from outside the repo
// root, which is exactly what importing fakeSupabase.ts from web/ needs to
// do. See web/lib/dispatchCommand.test.ts, the first caller from outside
// this workspace.
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = path.resolve(MODULE_DIR, '..', '..', '..', 'supabase', 'migrations');
const DEFAULT_ZAOOS_FIXTURE_PATH = path.resolve(MODULE_DIR, 'zaoos-schema.json');

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
 * 0002_discord_roster.sql's header and 0005_respect_game.sql's comments), so
 * this parser has no CREATE TABLE to read their schema from.
 *
 * These are PARTIALLY covered, not uncovered: buildSchema() merges in a
 * checked-in snapshot of their real column names (src/lib/testing/
 * zaoos-schema.json, produced by scripts/refresh-zaoos-schema.mjs), so
 * assertWritable rejects an unknown column on them exactly as it does for a
 * table these migrations do create. What that snapshot does NOT give us:
 * which columns are NOT NULL, and CHECK constraints - PostgREST's schema
 * description exposes neither in a form safe to trust (its `required` array
 * conflates real not-null columns with every auto-generated primary key; see
 * scripts/refresh-zaoos-schema.mjs for why demanding a primary key on insert
 * would reject every correct write). So these four tables get column-existence
 * checking only - never call this list "fully covered", and see
 * assertWritable.test.ts for a test that pins down exactly that boundary.
 */
export const PARTIALLY_COVERED_TABLES = [
  'fractal_sessions',
  'fractal_scores',
  'respect_members',
  'users',
] as const;

// A composite primary key written as a table-level segment - `primary key
// (a, b)` - is safe BY MECHANISM, not by luck: its first token is `primary`,
// which is in this set, so parseColumnSegment refuses to treat the segment
// as a column at all and cleanly skips it, rather than misparsing "key" as a
// column name or "(a, b)" as a type. Recorded here so the next reader does
// not have to re-derive it.
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

function stripComments(sql: string): string {
  // Block comments first (so a `--` accidentally sitting inside one doesn't
  // get treated as a line comment that stops early), then line comments.
  // No current migration uses `/* ... */` - 0006 documents itself with `--`
  // blocks - but a future author choosing that style must not be able to
  // take down buildSchema() for every test in the repo just by writing an
  // illustrative `check (...)` inside one.
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
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
  // A real DEFAULT clause always precedes any CHECK in Postgres's column
  // grammar, so only look for the `default` keyword in the text before the
  // first `check` - otherwise a CHECK list that happens to contain the
  // literal value 'default' (e.g. `check (status in ('default','other'))`)
  // reads as a DEFAULT clause and silently disables the not-null-on-insert
  // rule for that column, the one rule with no other backstop.
  const checkStart = rest.search(/\bcheck\b/i);
  const beforeCheck = checkStart === -1 ? rest : rest.slice(0, checkStart);
  const hasDefault = /\bdefault\b/i.test(beforeCheck);
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

// Shared phrase fragments for "alter table ... add column if not exists" -
// used by BOTH assertOnlyKnownAlterAddColumnShapes (the shape guard) and
// iterAddColumnStatements (the collector that actually adds the column to
// the model), so the two cannot silently disagree about which statements
// this parser accepts. They used to be written as two separate regexes: the
// guard tolerated whitespace variation (\s+) between keywords, the collector
// required literal single spaces. A migration wrapped across lines, or
// written with extra spaces, would pass the guard (it correctly saw "if not
// exists" present) while the collector's stricter regex failed to match -
// the column silently never joined the model, and assertWritable rejected a
// correct insert as "no such column", accusing the payload for a gap
// between two regexes that were supposed to agree. Building both from these
// same fragments makes that drift structurally impossible, not just
// currently absent.
const ADD_COLUMN = String.raw`add\s+column`;
const IF_NOT_EXISTS = String.raw`if\s+not\s+exists`;

// An `alter table ... add column <c> ...` that omits the literal "if not
// exists" phrase - a perfectly ordinary, valid Postgres statement - never
// matches iterAddColumnStatements's regex, so the column silently never
// joins the model. assertWritable then rejects a correct payload as "no
// such column", blaming the payload for a gap in this parser. That is the
// same "silently unconstrained" trap this whole guard exists to catch, just
// moved from CHECK constraints to ALTER statements - so this fails loudly
// at parse time instead, naming the migration and the fragment, and
// pointing at iterAddColumnStatements as the function to teach this shape.
function assertOnlyKnownAlterAddColumnShapes(sql: string, fileLabel: string): void {
  const re = new RegExp(
    String.raw`alter\s+table\s+public\.\w+\s+${ADD_COLUMN}\s+(?!${IF_NOT_EXISTS}\b)\S+`,
    'gi',
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    throw new Error(
      `schemaFromMigrations: ${fileLabel} has an "alter table ... add column" statement this ` +
        `parser does not recognise: ${match[0].trim()} ... Only "add column if not exists" is ` +
        `understood - teach iterAddColumnStatements this shape (or add "if not exists" to the ` +
        `migration) before assertWritable can be trusted to enforce it against this column. ` +
        `Silently leaving the column out of the model would reject a correct payload as an ` +
        `unknown column.`,
    );
  }
}

// A table-level NAMED check constraint written INSIDE a `create table (...)`
// body, e.g. `constraint t_status_check check (status in ('a','b'))`, is a
// separate segment whose first token is `constraint` - parseColumnSegment
// correctly refuses to treat it as a column (TABLE_CONSTRAINT_KEYWORDS), but
// until this existed, nothing ever attached its values to the column either.
// That produced a CHECK that parses (assertOnlyKnownCheckShapes is satisfied
// - this is a recognised `<col> in (<list>)` shape), throws nothing, and
// constrains nothing: the original "silently unconstrained" failure, in a
// shape the CHECK-shape guard doesn't catch because there is nothing
// unrecognised about it - only unattached.
function applyTableLevelNamedChecks(body: string, columns: Map<string, ColumnSchema>): void {
  const re = /\bconstraint\s+\w+\s+check\s*\(\s*(\w+)\s+in\s*\(([^)]+)\)\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    const [, colName, valuesText] = match;
    const col = columns.get(colName);
    if (!col) continue;
    col.checkValues = valuesFromList(valuesText);
  }
}

function applyCreateTables(sql: string, model: SchemaModel, fileLabel: string): void {
  const re = /create table if not exists public\.(\w+)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    const tableName = match[1];

    // applyCreateTables REPLACES a table's column model wholesale - it has
    // no way to know a later `create table if not exists` is a no-op re-
    // declaration of a table this parser already modeled (created earlier,
    // or altered since). Postgres treats the re-declaration as a harmless
    // no-op; this parser cannot, because re-parsing it would silently drop
    // any column an earlier ALTER added - e.g. a future re-declaration of
    // discord_roster that omits is_async (added by 0006) would make
    // createSession's correct insert look like it uses an unknown column,
    // accusing a correct payload instead of the migration that narrowed the
    // model. So this throws at parse time instead: teach applyCreateTables
    // to MERGE into the existing model rather than replace it before adding
    // a migration that re-declares an existing table.
    if (model.tables.has(tableName)) {
      throw new Error(
        `schemaFromMigrations: ${fileLabel} has "create table if not exists public.${tableName}" ` +
          `for a table this parser already has a model for (created or altered by an earlier ` +
          `migration). applyCreateTables replaces a table's column model wholesale, so re-parsing ` +
          `this statement would silently drop any column an earlier ALTER added and reject a ` +
          `correct write as an unknown column. Teach applyCreateTables to merge into the existing ` +
          `model instead of replacing it before this migration can be trusted.`,
      );
    }

    const openIndex = match.index + match[0].length - 1;
    const closeIndex = findMatchingParen(sql, openIndex);
    const body = sql.slice(openIndex + 1, closeIndex);

    const columns = new Map<string, ColumnSchema>();
    for (const segment of splitTopLevel(body)) {
      const col = parseColumnSegment(segment);
      if (col) columns.set(col.name, col);
    }
    applyTableLevelNamedChecks(body, columns);
    model.tables.set(tableName, { name: tableName, columns });
  }
}

interface AddColumnStatement {
  table: string;
  column: string;
  col: ColumnSchema;
}

/** Yields every `alter table public.<t> add column if not exists <c> ...`
 * statement in `sql`, regardless of whether `<t>` is a table these
 * migrations also `create table`-d. Shared by applyAddColumns (which only
 * applies the ones targeting a known table) and collectAllAddedColumns
 * (which needs ALL of them, including ones targeting a
 * PARTIALLY_COVERED_TABLES table like fractal_sessions, to compute the
 * union with the ZAO OS snapshot and to report pendingMigrationColumns()). */
function* iterAddColumnStatements(sql: string): Generator<AddColumnStatement> {
  // Built from the same ADD_COLUMN/IF_NOT_EXISTS fragments as
  // assertOnlyKnownAlterAddColumnShapes - see the comment there for why
  // that matters: these two must never accept different sets of statements.
  const re = new RegExp(
    String.raw`alter\s+table\s+public\.(\w+)\s+${ADD_COLUMN}\s+${IF_NOT_EXISTS}\s+(\w+)\s+([^;]*);`,
    'gi',
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(sql))) {
    const [, tableName, colName, rest] = match;
    const stopAt = rest.search(COLUMN_STOP_WORDS);
    const type = (stopAt === -1 ? rest : rest.slice(0, stopAt)).trim();
    yield {
      table: tableName,
      column: colName,
      col: {
        name: colName,
        type,
        notNull: /not\s+null/i.test(rest) || /\bprimary\s+key\b/i.test(rest),
        hasDefault: /\bdefault\b/i.test(rest),
      },
    };
  }
}

function applyAddColumns(sql: string, model: SchemaModel): void {
  for (const { table: tableName, column: colName, col } of iterAddColumnStatements(sql)) {
    const table = model.tables.get(tableName);
    // A table these migrations never `create table`-d (e.g. fractal_sessions,
    // owned by ZAO OS) is left for buildSchema()'s ZAO OS fixture merge
    // rather than being half-guessed from a single ALTER. See
    // PARTIALLY_COVERED_TABLES and collectAllAddedColumns.
    if (!table) continue;
    table.columns.set(colName, col);
  }
}

/** Every `add column if not exists` this repo's migrations make, keyed by
 * table, regardless of whether that table is also `create table`-d here.
 * For a PARTIALLY_COVERED_TABLES table this is exactly the columns this
 * repo's own migrations extend it with - e.g. fractal_sessions.meeting_number
 * from 0005 - which is what applyZaoosColumnExistence unions into the live
 * snapshot, and what pendingMigrationColumns() diffs against it. */
function collectAllAddedColumns(sqlTexts: string[]): Map<string, Map<string, ColumnSchema>> {
  const byTable = new Map<string, Map<string, ColumnSchema>>();
  for (const raw of sqlTexts) {
    const sql = stripComments(raw);
    for (const { table, column, col } of iterAddColumnStatements(sql)) {
      if (!byTable.has(table)) byTable.set(table, new Map());
      byTable.get(table)!.set(column, col);
    }
  }
  return byTable;
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

/** Shape of src/lib/testing/zaoos-schema.json, written by
 * scripts/refresh-zaoos-schema.mjs from the live ZAO OS PostgREST OpenAPI
 * description. `format` is the Postgres type PostgREST reports (e.g. "uuid",
 * "text", "timestamp with time zone") - kept for a human reading the fixture,
 * not used for any enforcement decision. */
export interface ZaoosSchemaProvenance {
  sourceHost: string;
  projectRef: string;
  fetchedAtUtc: string;
  /** The date by which this snapshot must be re-verified against the live
   * database. See schemaFromMigrations.test.ts's freshness test, which fails
   * from midnight UTC ON this date - not the day after it - naming
   * scripts/refresh-zaoos-schema.mjs as the fix. A time-bound claim nobody
   * re-checks is worse than no claim at all. */
  recheckBy: string;
  note: string;
}

export interface ZaoosSchemaFixture {
  provenance: ZaoosSchemaProvenance;
  tables: Record<string, { columns: Record<string, { format: string | null }> }>;
}

/** Reads the checked-in ZAO OS schema snapshot. No network - CI has no
 * credentials for that project, so this must work from the committed fixture
 * alone. Exported (not just used internally) so a freshness test can check
 * `provenance.recheckBy` without paying for a full buildSchema(). */
export function loadZaoosSchema(
  fixturePath = DEFAULT_ZAOOS_FIXTURE_PATH,
): ZaoosSchemaFixture {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as ZaoosSchemaFixture;
}

/** Merges the ZAO OS fixture's four tables into `model` as column-existence-only
 * schemas: every column is marked `notNull: false` with no `checkValues`, so
 * assertWritable's not-null and CHECK logic - which does apply to the tables
 * these migrations create - never fires for these four. Only "is this key a
 * real column" is enforced. See PARTIALLY_COVERED_TABLES.
 *
 * `migrationColumns` (from collectAllAddedColumns) is UNIONED in on top of
 * the snapshot, not used to replace it: a table like fractal_sessions is
 * both external (owned by ZAO OS) AND extended by this repo's own migrations
 * (0005 adds meeting_number). The live snapshot can be stale relative to
 * migrations ZAO OS hasn't applied yet - a tracked deployment gap (see
 * pendingMigrationColumns()), not evidence the code is wrong - so a column
 * this repo's migrations define is still a "known" column for existence
 * checking. This does not weaken unknown-column detection: only the exact
 * column names our own migrations add are unioned in, so a typo like
 * `meetingnumber` is still rejected. Columns added this way get the same
 * existence-only treatment as the rest of the table (notNull: false,
 * hasDefault: true) rather than whatever the migration happens to say, so
 * the "column existence only" boundary stays uniform across the whole
 * table regardless of which source a column came from. */
function applyZaoosColumnExistence(
  model: SchemaModel,
  fixture: ZaoosSchemaFixture,
  migrationColumns: Map<string, Map<string, ColumnSchema>>,
): void {
  for (const tableName of PARTIALLY_COVERED_TABLES) {
    const tableFixture = fixture.tables[tableName];
    if (!tableFixture) {
      throw new Error(
        `schemaFromMigrations: zaoos-schema.json has no entry for "${tableName}", one of ` +
          `PARTIALLY_COVERED_TABLES. Re-run scripts/refresh-zaoos-schema.mjs.`,
      );
    }
    const columns = new Map<string, ColumnSchema>();
    for (const [colName, colSpec] of Object.entries(tableFixture.columns)) {
      columns.set(colName, {
        name: colName,
        type: colSpec.format ?? 'unknown',
        // Deliberately false for every column here, always - see the
        // function doc comment. Not a parsed fact about the real column.
        notNull: false,
        hasDefault: true,
      });
    }
    for (const [colName, migrationCol] of migrationColumns.get(tableName) ?? []) {
      if (columns.has(colName)) continue; // live snapshot already has it
      columns.set(colName, {
        name: colName,
        type: migrationCol.type,
        notNull: false,
        hasDefault: true,
      });
    }
    model.tables.set(tableName, { name: tableName, columns });
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
    const sql = stripComments(raw);
    assertOnlyKnownCheckShapes(sql, label);
    assertOnlyKnownAlterAddColumnShapes(sql, label);
    applyCreateTables(sql, model, label);
    applyAddColumns(sql, model);
    applyAddedChecks(sql, model);
  });
  return model;
}

/** Builds the schema model from every *.sql file in migrationsDir, applied
 * in filename order (the same order Supabase applies them in), then merges in
 * column-existence-only coverage for PARTIALLY_COVERED_TABLES from the
 * checked-in ZAO OS snapshot (zaoosFixturePath). */
export function buildSchema(
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  zaoosFixturePath = DEFAULT_ZAOOS_FIXTURE_PATH,
): SchemaModel {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const sqlTexts = files.map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'));
  const model = parseMigrations(sqlTexts, files);
  const migrationColumns = collectAllAddedColumns(sqlTexts);
  applyZaoosColumnExistence(model, loadZaoosSchema(zaoosFixturePath), migrationColumns);
  return model;
}

export interface PendingMigrationColumn {
  table: string;
  column: string;
}

/** Columns this repo's own migrations define for a PARTIALLY_COVERED_TABLES
 * table that the checked-in ZAO OS snapshot does not have - i.e. exactly
 * what applying this repo's still-pending migrations to the ZAO OS project
 * would add. Today that is fractal_sessions.meeting_number (0005), because
 * migrations 0001-0005 have never been applied there.
 *
 * This is DRIFT INFORMATION, not a failure: buildSchema() already unions
 * these columns in (see applyZaoosColumnExistence), so assertWritable
 * accepts them. A test surfacing this list should report what it finds, not
 * throw - the pending-migration status is a tracked deployment gap, and a
 * red suite would misrepresent it as a code defect. */
export function pendingMigrationColumns(
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
  zaoosFixturePath = DEFAULT_ZAOOS_FIXTURE_PATH,
): PendingMigrationColumn[] {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const sqlTexts = files.map((f) => readFileSync(path.join(migrationsDir, f), 'utf8'));
  const migrationColumns = collectAllAddedColumns(sqlTexts);
  const fixture = loadZaoosSchema(zaoosFixturePath);

  const pending: PendingMigrationColumn[] = [];
  for (const table of PARTIALLY_COVERED_TABLES) {
    const added = migrationColumns.get(table);
    if (!added) continue;
    const liveColumns = new Set(Object.keys(fixture.tables[table]?.columns ?? {}));
    for (const column of added.keys()) {
      if (!liveColumns.has(column)) pending.push({ table, column });
    }
  }
  return pending;
}
