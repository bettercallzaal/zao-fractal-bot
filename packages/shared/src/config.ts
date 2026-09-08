// Verified on-chain state, per ZAOOS research docs 975/977/981/982.
// Never hardcode older figures (48h windows, Gini 0.23, "~200 members") - see doc 977.

export const OPTIMISM_RPC_URL =
  process.env.OPTIMISM_RPC_URL ?? 'https://mainnet.optimism.io';

export const OG_RESPECT_ADDRESS = '0x34cE89baA7E4a4B00E17F7E4C0cb97105C216957' as const;
export const ZOR_RESPECT_ADDRESS = '0x9885CCeEf7E8371Bf8d6f2413723D25917E7445c' as const;
export const OREC_EXECUTOR_ADDRESS = '0xcB05F9254765CA521F7698e61E0A6CA6456Be532' as const;

export const ZOR_TOKEN_ID = 0n;

// Fibonacci-style Respect distribution, rank 1 (Level 6) through rank 6 (Level 1).
// Matches fractalbotapril2026's config.RESPECT_POINTS exactly - do not change
// without updating the whitepaper's Respect Game section (doc 718b).
export const RESPECT_POINTS = [110, 68, 42, 26, 16, 10] as const;

export const MAX_GROUP_MEMBERS = 6;
export const MIN_GROUP_MEMBERS = 2;

/** How few voters can rank an absent person. Distinct from MIN_GROUP_MEMBERS,
 * which is how few people can play at all - do not collapse them.
 *
 * Three is the smallest number that is actually a vote. At 1 it is a decree;
 * at 2 a strict majority is 2, so it is unanimity and any disagreement
 * deadlocks under the no-tie-break rule. At 3 the threshold is 2, a real
 * majority that survives one dissent. Spec 2026-09-02 section 3.2. */
export const MIN_VOTERS = 3;

/** A submission counts if it landed within this many hours before the
 * session's start. Compared against session start, not wall clock, so the
 * window does not drift while a fractal runs. Spec section 5. */
export const ASYNC_WINDOW_HOURS = 12;

export const STARTING_LEVEL = 6;
export const ENDING_LEVEL = 1;
