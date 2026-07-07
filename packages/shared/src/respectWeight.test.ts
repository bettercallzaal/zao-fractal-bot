import { describe, expect, it } from 'vitest';
import { computeRespectWeight } from './respectWeight.js';

describe('computeRespectWeight', () => {
  it('sums OG (wei, 18 decimals) and ZOR (raw integer) into a rounded weight', () => {
    const og = { status: 'success' as const, result: 500_000_000_000_000_000n }; // 0.5 OG
    const zor = { status: 'success' as const, result: 482n };
    const result = computeRespectWeight(og, zor);
    expect(result.weight).toBe(483); // round(0.5 + 482)
    expect(result.complete).toBe(true);
  });

  it('does not treat a failed read as a zero balance for completeness purposes', () => {
    const og = { status: 'failure' as const };
    const zor = { status: 'success' as const, result: 100n };
    const result = computeRespectWeight(og, zor);
    expect(result.complete).toBe(false);
    // weight still computes (falls back to 0 for the failed leg) so callers
    // can decide whether to display it, but `complete: false` is the signal
    // that this value should not be cached/written as authoritative.
    expect(result.weight).toBe(100);
  });

  it('matches the ZAOOS app formula for a whole-number OG balance', () => {
    const og = { status: 'success' as const, result: 38_484_000_000_000_000_000_000n }; // 38,484 OG
    const zor = { status: 'success' as const, result: 0n };
    expect(computeRespectWeight(og, zor).weight).toBe(38_484);
  });
});
