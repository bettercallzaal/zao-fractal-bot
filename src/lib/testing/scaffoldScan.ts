// Statically scans every tracked file in this repo for scaffolding that was
// written with an explicit intent to be removed before commit, so a stalled
// fail-first verification (deliberately break the code, watch the test go
// red, revert) that dies between the break and the revert is caught by
// machinery instead of a human reading the diff.
//
// This exists because of a near-miss: an agent doing fail-first verification
// stalled and died between the break and the revert, leaving a block in
// src/discord/testing/fakeDiscord.ts marked
// "TEMP FOR RED-CHECK ONLY - reverted before commit." That block re-added a
// `.threads.create` to the fake *thread* object, quietly destroying a
// guarantee enforced by absence (the fake thread having no `.threads` is
// what makes production code throw instead of silently nesting a thread on
// the wrong object). The suite stayed green the entire time - nothing about
// a passing run distinguished "harness intact" from "harness quietly
// weakened". It was caught only because a human happened to read the diff.
//
// Follows the shape of secretScan.ts / secretScan.test.ts - that pattern is
// established in this repo and consistency beats novelty. Scans **tracked
// files only**, via `git ls-files`, same as the secret scanner, for the same
// reason: node_modules/dist/.next are already excluded by .gitignore, and
// the directory-name filter below is a second, structural line of defense
// rather than relying on that staying true.
//
// Deliberately high-confidence, unambiguous-intent-to-remove markers only.
// TODO and FIXME are NOT scanned for - see the comment above
// SCAFFOLD_MARKERS for why. See scaffoldScan.test.ts for the catch-proof and
// the no-false-positive proof (this scan running clean against the real
// repo with an empty allowlist).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface ScaffoldPattern {
  name: string;
  regex: RegExp;
  /** Why this exact marker earns a place in a high-confidence-only scanner. */
  reason: string;
}

export interface ScaffoldMatch {
  file: string;
  pattern: string;
  /** The matched text itself, truncated. */
  snippet: string;
}

export interface ScaffoldScanAllowlistEntry {
  file: string;
  /** A short fragment of the matched text. Allowlisting keys on file +
   * fragment, not just filename, so clearing one line never blinds the
   * scanner to everything else in that file. */
  fragment: string;
  /** Why this exact match is not leftover scaffolding. Required so an
   * allowlist entry is a documented decision, not a silent skip. */
  reason: string;
}

export interface ScaffoldScanResult {
  /** Tracked files (via `git ls-files`) that were actually scanned. */
  filesScanned: number;
  /** Matches that survived the allowlist - a nonempty list here means STOP,
   * this is either real leftover scaffolding (report it) or a pattern that
   * needs tightening, never a quiet allowlist entry. */
  findings: ScaffoldMatch[];
  /** Matches that were suppressed by SCAFFOLD_SCAN_ALLOWLIST, for visibility
   * - so a passing test never hides how many exceptions it is leaning on. */
  allowlisted: ScaffoldMatch[];
}

// Directories that must never be walked even if something upstream of this
// scanner ever listed them - dependency trees and build output. `git
// ls-files` already excludes them via .gitignore; this is the second,
// structural line of defense, not the only one.
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.next']);

// Files this scanner must never scan, because they are prose *about* the
// markers rather than scaffolding left behind in code - most concretely,
// this file and its test, and any doc under docs/ (including the incident
// write-up that led to this scanner and the plan/design docs that describe
// it). Excluding docs/ wholesale is the tradeoff picked here over requiring
// each marker to sit inside a source-code comment: docs/ in this repo is
// exclusively markdown written to be read by humans (specs, plans, audits,
// reports), never a place production or test code lives, so nothing that
// would actually indicate live scaffolding can be lost by skipping it - and
// the alternative (a "must be inside a // or /* comment" rule) would still
// have to special-case this very file, which legitimately contains each
// marker string in a source-file comment. Skipping by path is simpler and
// exactly as safe here.
const SKIP_FILES = new Set([
  'src/lib/testing/scaffoldScan.ts',
  'src/lib/testing/scaffoldScan.test.ts',
]);

function isSkippedPath(file: string): boolean {
  const parts = file.split(path.sep);
  if (parts.some((p) => SKIP_DIR_NAMES.has(p))) return true;
  if (parts[0] === 'docs') return true;
  if (SKIP_FILES.has(file)) return true;
  return false;
}

// Each marker is a shape that signals unambiguous intent to remove before
// commit, or (for `.only(`) a mechanical suite-weakening that silently
// reports green while running almost nothing.
//
// TODO and FIXME are deliberately NOT included. They are ordinary
// long-lived engineering notes this codebase may legitimately carry
// (tracked work, known limitations) - not a promise of imminent removal.
// Measured directly: `git ls-files -z | xargs -0 grep -c` for TODO or FIXME
// across every tracked file in this repo returns zero matches today, so
// excluding them costs nothing right now - but the decision doesn't rest on
// today's count staying zero. A scanner that flags routine engineering
// notes is a noisy scanner, and a noisy scanner gets deleted, which is the
// exact outcome that costs everything (see the incident this scanner exists
// to prevent). If TODO/FIXME hygiene is ever wanted, it belongs in a
// separate, explicitly-opt-in check, not bundled into a guard whose whole
// value is that a finding always means "stop and look".
export const SCAFFOLD_MARKERS: readonly ScaffoldPattern[] = [
  {
    name: 'temp-marker',
    // Matches "TEMP FOR ..." (as in "TEMP FOR RED-CHECK ONLY", the exact
    // marker left behind by the incident this scanner exists to catch),
    // "TEMPORARY:" and "TEMP:". All three are a comment author explicitly
    // flagging code that must not survive to commit - distinct from TODO,
    // which flags future work, not present-tense scaffolding.
    regex: /\bTEMP(?:ORARY)?\s*(?:FOR\b|:)/,
    reason:
      'TEMP FOR / TEMPORARY: / TEMP: is a comment author explicitly flagging code that must not ' +
      "survive to commit - this is the exact marker (\"TEMP FOR RED-CHECK ONLY\") the incident " +
      'left behind in fakeDiscord.ts. Distinct from TODO/FIXME, which flag future work rather ' +
      'than present, still-live scaffolding.',
  },
  {
    name: 'do-not-commit',
    regex: /DO\s*NOT\s*COMMIT/,
    reason:
      'An unambiguous, explicit instruction to the author\'s future self (or a reviewer) not to ' +
      'commit this. No legitimate long-lived comment reads this way.',
  },
  {
    name: 'revert-before-commit',
    regex: /revert before commit/i,
    reason:
      'States outright that the surrounding change is meant to be reverted before the commit ' +
      'that never happened - exactly the failure mode of the fail-first-verification incident.',
  },
  {
    name: 'xxx-marker',
    regex: /\bXXX:/,
    reason:
      'XXX: is conventionally "this is broken", distinct from TODO ("this could be improved ' +
      'later"). It signals a known-bad state left in place, which is scaffolding-shaped even ' +
      "when it isn't literally about a revert.",
  },
  {
    name: 'test-only',
    // describe.only(, it.only(, test.only( - and their .skip-adjacent
    // sibling `fit(`/`fdescribe(` variants are deliberately NOT included
    // here since this repo's suite uses vitest's describe/it/test, not
    // Jasmine/Jest's f-prefixed aliases. A stray `.only` silently reduces a
    // suite to one test while still reporting green - the same class of
    // harm as the fakeDiscord incident: the suite looks like it ran and did
    // not.
    regex: /\b(?:describe|it|test)\.only\s*\(/,
    reason:
      'A stray .only silently reduces a suite to one test while still reporting green - the ' +
      'same class of harm as the incident this scanner exists to catch: the suite looks like ' +
      'it ran and it did not. Matches describe.only(/it.only(/test.only( specifically, not ' +
      '.only used as an unrelated property/method name.',
  },
];

// Allowlisted matches - each is a documented decision, not a silent skip.
// Keyed on file + a fragment of the matched text (not just the filename) so
// clearing one line never blinds the scanner to the rest of that file.
// Starts empty, and per the brief, stays empty unless a match is a genuine,
// unavoidable, considered exception - never a way to paper over a pattern
// that's too broad or a real leftover.
export const SCAFFOLD_SCAN_ALLOWLIST: readonly ScaffoldScanAllowlistEntry[] = [];

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

/** Scans every tracked file (via `git ls-files`) for the high-confidence
 * scaffolding markers in SCAFFOLD_MARKERS, applying SCAFFOLD_SCAN_ALLOWLIST
 * to suppress documented, considered exceptions. `cwd` defaults to the repo
 * root the test runner is invoked from - overridable so a test can point
 * this at a scratch directory containing a single planted fixture file
 * without touching the real repo's tracked files. */
export function scanForScaffolding(cwd: string = process.cwd()): ScaffoldScanResult {
  const files = execFileSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  })
    .split('\0')
    .filter((f) => f.length > 0 && !isSkippedPath(f));

  const findings: ScaffoldMatch[] = [];
  const allowlisted: ScaffoldMatch[] = [];

  for (const file of files) {
    const full = path.join(cwd, file);
    let content: string;
    try {
      content = readFileSync(full, 'utf8');
    } catch {
      // Unreadable (e.g. deleted between ls-files and read, or genuinely
      // binary despite being tracked) - skip rather than crash the scan.
      continue;
    }

    for (const pattern of SCAFFOLD_MARKERS) {
      const re = new RegExp(
        pattern.regex,
        pattern.regex.flags.includes('g') ? pattern.regex.flags : `${pattern.regex.flags}g`,
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(content))) {
        const match: ScaffoldMatch = {
          file,
          pattern: pattern.name,
          snippet: truncate(m[0]),
        };
        const allow = SCAFFOLD_SCAN_ALLOWLIST.find(
          (a) => a.file === file && match.snippet.includes(a.fragment),
        );
        if (allow) {
          allowlisted.push(match);
        } else {
          findings.push(match);
        }
        if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-length matches
      }
    }
  }

  return { filesScanned: files.length, findings, allowlisted };
}
