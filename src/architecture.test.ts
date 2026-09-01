import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Spec section 3: the game engine and the action layer must be callable with
 * no Discord objects in their signatures, so a second surface in v3 is an
 * adapter rather than a rewrite. This is the kind of boundary that quietly
 * stops being true unless a test enforces it. */
function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('layering', () => {
  it('no file under src/game or src/commands imports discord.js', () => {
    const dirs = ['src/game', 'src/commands'].filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const file of filesUnder(dir)) {
        const src = readFileSync(file, 'utf8');
        if (/from\s+['"]discord\.js['"]/.test(src)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
