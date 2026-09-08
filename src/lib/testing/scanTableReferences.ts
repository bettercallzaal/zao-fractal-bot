// Statically enumerates every Supabase table this codebase's non-test source
// refers to via `.from('<table>')`, so a test can check each one against the
// schema guard (schemaFromMigrations.ts / assertWritable.ts) without relying
// on a test happening to exercise that write.
//
// This exists to close the gap those files openly admit: assertWritable
// SKIPS a table it has no schema entry for, silently. A new table, a
// typo'd name, or a table nobody wrote a test for goes completely
// unguarded and reads exactly like covered code. See tableCoverage.test.ts.
//
// Design choice: this collects EVERY `.from('table')` call, not just ones
// followed by `.insert`/`.upsert`/`.update`. Reliably distinguishing a read
// chain from a write chain by scanning text alone (multi-line chains,
// intermediate `.select()` calls, different client variable names per file)
// is exactly the kind of heuristic that breaks for reasons that have nothing
// to do with a genuine unknown table - which is the trap this test is meant
// to avoid. Over-covering (checking read-only tables too) is harmless: they
// are either already known to the guard or the author gets a clear, one-time
// prompt to teach the guard about them. Silently missing a write because a
// read/write classifier got confused would recreate the exact failure mode
// this whole effort exists to kill.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export interface TableScanResult {
  /** Distinct table names resolved from a literal `.from('name')` argument. */
  tables: Set<string>;
  /** Non-test *.ts files under rootDir that were scanned. */
  filesScanned: number;
  /** `.from(...)` call sites (other than `Array.from(...)`) whose argument
   * was not a simple quoted string, so no table name could be resolved
   * statically - e.g. a computed table name, a variable, a template
   * literal. Reported rather than silently dropped, so a blind spot here is
   * visible instead of invisible. */
  unresolvedCount: number;
  /** Up to a handful of `file:snippet` samples for the unresolved calls, to
   * make a nonzero unresolvedCount actionable instead of just a number. */
  unresolvedSamples: string[];
}

function listSourceFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile() && full.endsWith('.ts') && !full.endsWith('.test.ts')) {
        out.push(full);
      }
    }
  };
  walk(rootDir);
  return out;
}

/** Strips comments so a table name mentioned only in prose (a doc comment,
 * an example) is never mistaken for a real reference. Block comments first
 * (so a `//` inside one doesn't get treated as starting a line comment that
 * ends early). Line comments are only stripped when the `//` is not
 * immediately preceded by `:` - so a `https://...` string literal survives -
 * this is a best-effort heuristic, not a tokenizer, which is fine: worst
 * case it under-strips a comment and this scanner sees one extra `.from(...)`
 * call, which is exactly the "over-covering is fine" tradeoff this file is
 * built around. */
function stripComments(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Finds every `.from(...)` call in `src` and returns, for each, whatever
 * identifier ends the text immediately before it (so a caller can recognise
 * `Array.from(...)`) plus the exact text between the matching parentheses
 * (bracket-aware, so a call like `.from(pick('a', 'b'))` - not that this
 * codebase has one - doesn't get truncated at the first `)`).
 *
 * Deliberately does not require the preceding identifier to sit directly
 * against the dot: this codebase routinely chains
 * `supabase\n  .from('table')\n  .select(...)` across lines, and a stricter
 * match would make those calls invisible rather than merely unresolved -
 * the exact silent gap this scanner exists to avoid. */
function findFromCalls(src: string): Array<{ precedingIdentifier: string; arg: string }> {
  const calls: Array<{ precedingIdentifier: string; arg: string }> = [];
  const fromRe = /\.from\(/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(src))) {
    const before = src.slice(Math.max(0, m.index - 40), m.index).trimEnd();
    const identMatch = before.match(/([A-Za-z_$][\w$]*)$/);

    const openIndex = m.index + m[0].length - 1;
    let depth = 0;
    let closeIndex = -1;
    for (let i = openIndex; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') {
        depth--;
        if (depth === 0) {
          closeIndex = i;
          break;
        }
      }
    }
    if (closeIndex === -1) continue; // unbalanced - not a call this scanner can read; skip
    calls.push({
      precedingIdentifier: identMatch ? identMatch[1] : '',
      arg: src.slice(openIndex + 1, closeIndex).trim(),
    });
  }
  return calls;
}

const QUOTED_IDENTIFIER = /^(['"`])([A-Za-z_][A-Za-z0-9_]*)\1$/;

/** Scans every non-test *.ts file under `rootDir` for Supabase table
 * references. See the file doc comment for why this collects all
 * `.from('table')` calls rather than trying to isolate writes. */
export function scanTableReferences(rootDir = 'src'): TableScanResult {
  const files = listSourceFiles(rootDir);
  const tables = new Set<string>();
  const unresolvedSamples: string[] = [];
  let unresolvedCount = 0;

  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const { precedingIdentifier, arg } of findFromCalls(src)) {
      // `Array.from({ length }, ...)` / `Array.from(iterable)` is JavaScript's
      // Array.from, not a Supabase query - it is not a table reference at
      // all, resolved or otherwise, and must not be counted as either.
      if (precedingIdentifier === 'Array') continue;

      const quoted = arg.match(QUOTED_IDENTIFIER);
      if (quoted) {
        tables.add(quoted[2]);
        continue;
      }
      unresolvedCount++;
      if (unresolvedSamples.length < 10) {
        // Deliberately not written as a literal ".from(" substring here -
        // this file is itself scanned (it is non-test source under src/),
        // and a literal ".from(" in this string would match this scanner's
        // own regex and report itself as an unresolved reference.
        unresolvedSamples.push(`${path.relative(process.cwd(), file)}: from(${arg})`);
      }
    }
  }

  return { tables, filesScanned: files.length, unresolvedCount, unresolvedSamples };
}
