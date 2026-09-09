// Statically scans every tracked file in this repo for text shapes that are
// nearly always a live credential, so a secret that lands in a tracked file
// is caught by CI - by machinery, not by a brief someone has to remember.
//
// This exists because the repo currently has NO secret guard of any kind: no
// pre-commit hook, no gitleaks config, no scanning step in
// .github/workflows/test.yml. "Never commit a secret" is an honour-system
// rule, and this mistake is irreversible - a key can be rotated, but once
// pushed to a public repo it is in the history forever.
//
// Scans **tracked files only**, via `git ls-files` - never walks
// node_modules, dist, or .next (this repo's .gitignore already keeps those
// out of `git ls-files`, but the filter below is a second, structural line
// of defense rather than relying on that staying true).
//
// Deliberately high-confidence patterns only. A scanner that cries wolf gets
// deleted within a week and then protects nothing - see the patterns'
// individual comments for why each one earns its place, and why bare hex
// (contract addresses, tx hashes, UUIDs - all over this codebase legitimately)
// is never matched on its own. See secretScan.test.ts for the catch-proof
// (a public jwt.io example token) and the no-false-positive proof (this
// scan running clean against the real repo).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface SecretPattern {
  name: string;
  regex: RegExp;
  /** Why this exact shape earns a place in a high-confidence-only scanner. */
  reason: string;
}

export interface SecretMatch {
  file: string;
  pattern: string;
  /** The matched text itself, truncated - never logged in full, so a real
   * finding doesn't get echoed into CI output. */
  snippet: string;
}

export interface SecretScanAllowlistEntry {
  file: string;
  /** A short fragment of (or hash covering) the matched text. Allowlisting
   * keys on file + fragment, not just filename, so clearing one line never
   * blinds the scanner to everything else in that file. */
  fragment: string;
  /** Why this exact match is not a live credential. Required so an
   * allowlist entry is a documented decision, not a silent skip. */
  reason: string;
}

export interface SecretScanResult {
  /** Tracked files (via `git ls-files`) that were actually scanned. */
  filesScanned: number;
  /** Matches that survived the allowlist - a nonempty list here means STOP,
   * don't commit, and report it. */
  findings: SecretMatch[];
  /** Matches that were suppressed by SECRET_SCAN_ALLOWLIST, for visibility -
   * so a passing test never hides how many exceptions it is leaning on. */
  allowlisted: SecretMatch[];
}

// Directories that must never be walked even if something upstream of this
// scanner ever listed them - dependency trees and build output. `git
// ls-files` already excludes them via .gitignore; this is the second,
// structural line of defense, not the only one.
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', '.next']);

function isSkippedPath(file: string): boolean {
  const parts = file.split(path.sep);
  return parts.some((p) => SKIP_DIR_NAMES.has(p));
}

// Each pattern is a shape that is nearly always a real credential, never a
// bare identifier this codebase legitimately contains in quantity (contract
// addresses, tx hashes, UUIDs - all bare hex, none of which these patterns
// touch).
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    name: 'jwt',
    // eyJ is the base64url encoding of '{"' - the start of every JWT header
    // JSON object. Followed by two more base64url segments (payload,
    // signature) joined by dots. This is exactly the shape of a Supabase
    // anon/service-role key, making it the highest-value catch in this repo.
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{10,}/,
    reason:
      'A JWT (eyJ... + two dots) is what a Supabase anon/service-role key looks like - the ' +
      "highest-value catch here. Three base64url segments joined by dots isn't a shape any " +
      'other legitimate content in this repo produces.',
  },
  {
    name: 'discord-bot-token',
    regex: /\b[A-Za-z0-9_-]{24,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/,
    reason:
      'Matches the three-segment, specifically-sized shape of a real Discord bot token ' +
      '(this bot reads DISCORD_TOKEN). Distinct from the JWT pattern by segment lengths, not ' +
      "just by starting with eyJ - Discord's own tokens aren't JWTs.",
  },
  {
    name: 'pem-private-key',
    regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    reason:
      'A PEM block header is unambiguous - nothing else in a text file produces this exact ' +
      'banner. Directly relevant: this bot signs with BOT_PRIVATE_KEY.',
  },
  {
    name: 'aws-access-key-id',
    regex: /AKIA[0-9A-Z]{16}/,
    reason:
      "AWS's own fixed-prefix key-id format. Not currently a secret this repo names, but the " +
      'shape is unambiguous and costs nothing to keep watching for.',
  },
  {
    name: 'assigned-secret-like-value',
    // The risky one: a long opaque string literal assigned to a name that
    // looks like a secret. This is what catches a raw SUPABASE_SERVICE_ROLE_KEY,
    // BOT_PRIVATE_KEY, NEYNAR_API_KEY, or BOT_API_SECRET value pasted directly
    // into source instead of read from process.env. Deliberately requires an
    // ASSIGNMENT (name = '...' / name: '...') rather than matching the name or
    // the value alone - `apiKey: string | undefined` and `process.env.X_API_KEY`
    // (an identifier, not a quoted literal) never match this, which is why
    // this repo's real apiKey/privateKey/clientSecret parameter names and
    // env-var reads all scan clean.
    regex: /(SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)\s*[=:]\s*(['"])[^'"]{20,}\2/i,
    reason:
      'Generic catch for a secret pasted directly into source under a key-shaped name, instead ' +
      'of read from process.env as every current call site does. Intentionally requires both a ' +
      "secret-ish name AND a quoted literal value 20+ chars long, so a parameter name like " +
      "`apiKey: string` or a `process.env.NEYNAR_API_KEY` read (an identifier, not a string " +
      'literal) never matches. This is the pattern most likely to false-positive, which is why ' +
      'it is last and why every match it produces must be checked by hand, not rubber-stamped.',
  },
];

// Allowlisted matches - each is a documented decision, not a silent skip.
// Keyed on file + a fragment of the matched text (not just the filename) so
// clearing one line never blinds the scanner to the rest of that file.
// Empty: as of this scanner's introduction, the repo has zero matches with
// zero allowlist entries - see secretScan.test.ts's no-false-positive proof.
export const SECRET_SCAN_ALLOWLIST: readonly SecretScanAllowlistEntry[] = [];

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

/** Scans every tracked file (via `git ls-files`) for the high-confidence
 * secret shapes in SECRET_PATTERNS, applying SECRET_SCAN_ALLOWLIST to
 * suppress documented, considered exceptions. `cwd` defaults to the repo
 * root the test runner is invoked from - overridable so a test can point
 * this at a scratch directory containing a single planted fixture file
 * without touching the real repo's tracked files. */
export function scanForSecrets(cwd: string = process.cwd()): SecretScanResult {
  const files = execFileSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  })
    .split('\0')
    .filter((f) => f.length > 0 && !isSkippedPath(f));

  const findings: SecretMatch[] = [];
  const allowlisted: SecretMatch[] = [];

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

    for (const pattern of SECRET_PATTERNS) {
      const re = new RegExp(pattern.regex, pattern.regex.flags.includes('g') ? pattern.regex.flags : `${pattern.regex.flags}g`);
      let m: RegExpExecArray | null;
      while ((m = re.exec(content))) {
        const match: SecretMatch = {
          file,
          pattern: pattern.name,
          snippet: truncate(m[0]),
        };
        const allow = SECRET_SCAN_ALLOWLIST.find(
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
