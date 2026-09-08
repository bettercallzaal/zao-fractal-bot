// Verifies the scaffolding guard both ways - see scaffoldScan.ts for the
// incident it exists to catch (a stalled fail-first-verification agent left
// a "TEMP FOR RED-CHECK ONLY - reverted before commit." block in
// fakeDiscord.ts that quietly destroyed a harness guarantee, and the suite
// stayed green the whole time).
//
// 1. It must catch: a scratch tracked file containing a DO NOT COMMIT marker
//    and a stray it.only( must be flagged, as two separate findings.
// 2. It must not cry wolf: run against this repo's real tracked files with
//    an empty allowlist, expect zero findings. A false positive here isn't
//    papered over with an allowlist entry - the instruction (and the whole
//    point of this file) is to tighten the pattern instead, because a guard
//    that cries wolf gets deleted within a week and then protects nothing.
//
// This file, and scaffoldScan.ts itself, are excluded from the scan by path
// (see SKIP_FILES in scaffoldScan.ts) rather than by assembling every marker
// from fragments - both files legitimately contain every marker string
// verbatim (as pattern definitions, and as planted fixture text below), and
// path-exclusion is the tradeoff documented in scaffoldScan.ts. Confirmed by
// the second test below actually running clean against this repo, which by
// then includes this very file.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCAFFOLD_SCAN_ALLOWLIST, scanForScaffolding } from './scaffoldScan.js';

describe('scanForScaffolding catches leftover scaffolding', () => {
  it('flags a DO NOT COMMIT marker and a stray it.only( planted in a tracked scratch file', () => {
    // A fresh git repo (not this one) so `git ls-files` inside
    // scanForScaffolding sees exactly the one planted file, and so this test
    // can never touch - or be seen as touching - this repo's own tracked
    // files or history.
    const dir = mkdtempSync(path.join(tmpdir(), 'scaffold-scan-catch-'));
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
      writeFileSync(
        path.join(dir, 'leftover.test.ts'),
        [
          '// DO NOT COMMIT: this block re-adds threads.create to the fake thread',
          'it.only("stays red until reverted", () => {',
          '  expect(true).toBe(true);',
          '});',
          '',
        ].join('\n'),
      );
      execFileSync('git', ['add', 'leftover.test.ts'], { cwd: dir });

      const result = scanForScaffolding(dir);

      expect(result.filesScanned).toBe(1);
      expect(result.findings).toHaveLength(2);
      const patterns = result.findings.map((f) => f.pattern).sort();
      expect(patterns).toEqual(['do-not-commit', 'test-only']);
      expect(result.findings.every((f) => f.file === 'leftover.test.ts')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('scanForScaffolding does not cry wolf against the real repo', () => {
  it("finds zero scaffolding markers in this repo's tracked files with an empty allowlist", () => {
    // Deliberately does NOT pass an allowlist entry to make this pass - per
    // the brief, a false positive here means either real leftover
    // scaffolding (report it, don't quietly allowlist it) or a pattern that
    // needs tightening.
    expect(
      SCAFFOLD_SCAN_ALLOWLIST.length,
      'the allowlist should stay empty - see the comment above SCAFFOLD_SCAN_ALLOWLIST in ' +
        'scaffoldScan.ts for why',
    ).toBe(0);

    const result = scanForScaffolding();

    // Visibility, not an assumption: the scope this test actually covers
    // should be visible in the test output, not just asserted as "enough".
    // eslint-disable-next-line no-console
    console.info(
      `scaffoldScan: ${result.filesScanned} tracked file(s) scanned, ${result.findings.length} ` +
        `finding(s), ${result.allowlisted.length} allowlisted match(es)`,
    );

    // A regression here (near-zero files) means the scan itself broke - not
    // that the repo suddenly shrank to almost nothing - so this fails loudly
    // rather than letting an empty scan pass by vacuously finding nothing to
    // flag.
    expect(
      result.filesScanned,
      'scanForScaffolding scanned suspiciously few files - check that `git ls-files` is being ' +
        'run from the repo root',
    ).toBeGreaterThan(100);

    if (result.findings.length > 0) {
      const details = result.findings
        .map((f) => `  ${f.file} [${f.pattern}]: ${f.snippet}`)
        .join('\n');
      throw new Error(
        `scaffoldScan found ${result.findings.length} leftover scaffolding marker(s) in ` +
          `tracked files:\n${details}\n` +
          `If this is real leftover scaffolding: finish removing it (revert the change it ` +
          `marks, or delete the stray .only) before committing.\n` +
          `If this is a false positive: tighten the pattern in scaffoldScan.ts - do not add an ` +
          `allowlist entry to silence a bad pattern.\n` +
          `If this is a genuine, unavoidable, considered exception: add an entry to ` +
          `SCAFFOLD_SCAN_ALLOWLIST in scaffoldScan.ts with a reason.`,
      );
    }
  });
});
