// Verifies the secret guard both ways - see secretScan.ts for why this repo
// needs one at all (no pre-commit hook, no gitleaks, no CI scanning step,
// and this class of mistake is irreversible: a key rotates, a public git
// history does not un-leak).
//
// 1. It must catch: a realistic fake JWT dropped into a scratch tracked file
//    must be flagged.
// 2. It must not cry wolf: run against this repo's real tracked files with
//    an empty allowlist, expect zero findings. A false positive here isn't
//    papered over with an allowlist entry - the instruction (and the whole
//    point of this file) is to tighten the pattern instead, because a guard
//    that cries wolf gets deleted within a week and then protects nothing.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SECRET_SCAN_ALLOWLIST, scanForSecrets } from './secretScan.js';

// A published example token from jwt.io's own debugger - not a real
// credential, and stated as such here per the instruction to never commit a
// secret, including in a test fixture.
const JWT_IO_EXAMPLE_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

describe('scanForSecrets catches a real credential shape', () => {
  it('flags a fake JWT planted in a tracked scratch file', () => {
    // A fresh git repo (not this one) so `git ls-files` inside scanForSecrets
    // sees exactly the one planted file, and so this test can never touch
    // - or be seen as touching - this repo's own tracked files or history.
    const dir = mkdtempSync(path.join(tmpdir(), 'secret-scan-catch-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
      // Variable name deliberately avoids SECRET/TOKEN/PASSWORD/PRIVATE_KEY/
      // API_KEY so this exercises the jwt pattern alone, not also the
      // generic assigned-secret-like-value pattern.
      writeFileSync(
        path.join(dir, 'leaked.ts'),
        `// jwt.io public example, not a real credential\nconst leaked = '${JWT_IO_EXAMPLE_TOKEN}';\n`,
      );
      execFileSync('git', ['add', 'leaked.ts'], { cwd: dir });

      const result = scanForSecrets(dir);

      expect(result.filesScanned).toBe(1);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].pattern).toBe('jwt');
      expect(result.findings[0].file).toBe('leaked.ts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('scanForSecrets does not cry wolf against the real repo', () => {
  it('finds zero secrets in this repo\'s tracked files with an empty allowlist', () => {
    // Deliberately does NOT pass an allowlist entry to make this pass - per
    // the brief, a false positive here means either a real secret (stop,
    // don't commit, report it) or a pattern that needs tightening, never a
    // quiet allowlist entry.
    expect(
      SECRET_SCAN_ALLOWLIST.length,
      'the allowlist should stay empty - see the comment above scanForSecrets.test.ts\'s ' +
        'no-false-positive assertion for why',
    ).toBe(0);

    const result = scanForSecrets();

    // Visibility, not an assumption: the scope this test actually covers
    // should be visible in the test output, not just asserted as "enough".
    // eslint-disable-next-line no-console
    console.info(
      `secretScan: ${result.filesScanned} tracked file(s) scanned, ${result.findings.length} ` +
        `finding(s), ${result.allowlisted.length} allowlisted match(es)`,
    );

    // A regression here (near-zero files) means the scan itself broke - not
    // that the repo suddenly shrank to almost nothing - so this fails loudly
    // rather than letting an empty scan pass by vacuously finding nothing to
    // flag.
    expect(
      result.filesScanned,
      'scanForSecrets scanned suspiciously few files - check that `git ls-files` is being run ' +
        'from the repo root',
    ).toBeGreaterThan(100);

    if (result.findings.length > 0) {
      const details = result.findings
        .map((f) => `  ${f.file} [${f.pattern}]: ${f.snippet}`)
        .join('\n');
      throw new Error(
        `secretScan found ${result.findings.length} possible secret(s) in tracked files:\n` +
          `${details}\n` +
          `If this is a real credential: STOP, do not commit, rotate it, and report it.\n` +
          `If this is a false positive: tighten the pattern in secretScan.ts - do not add an ` +
          `allowlist entry to silence a bad pattern.\n` +
          `If this is a genuine, unavoidable, considered exception: add an entry to ` +
          `SECRET_SCAN_ALLOWLIST in secretScan.ts with a reason.`,
      );
    }
  });
});
