import { formatEther } from 'viem';

// Ported to match ZAOOS's src/lib/respect/voteWeight.ts exactly (see doc 981
// section 4 / doc 982 decision #1). This is the single source of truth for
// "what is a member's Respect weight" - do not let this drift from the
// ZAOOS app's implementation again. If the app's formula changes, this must
// change too, ideally by extracting both into one shared package.

export interface BalanceRead {
  status: 'success' | 'failure';
  result?: bigint;
}

export interface RespectWeight {
  weight: number;
  /** True only if BOTH reads succeeded. A failed read must never be
   * silently treated as a zero balance - callers should refuse to write
   * a cached value when this is false. */
  complete: boolean;
}

export function computeRespectWeight(og: BalanceRead, zor: BalanceRead): RespectWeight {
  const ogValue = og.status === 'success' && og.result !== undefined
    ? Number(formatEther(og.result))
    : 0;
  const zorValue = zor.status === 'success' && zor.result !== undefined
    ? Number(zor.result)
    : 0;

  return {
    weight: Math.round(ogValue + zorValue),
    complete: og.status === 'success' && zor.status === 'success',
  };
}
