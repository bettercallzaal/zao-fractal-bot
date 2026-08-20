import { describe, expect, it } from 'vitest';
import {
  awardVerdict,
  MEETING_SEARCH_RADIUS,
  meetingSearchRange,
  meetingToPeriod,
  packAwardTokenId,
  type PendingAward,
  periodToMeeting,
  unpackAwardTokenId,
} from './awardVerification.js';

// Zaal's wallet + period 109 - the packed id was verified live against the
// ZOR contract on 2026-08-19: balanceOf(wallet, id) == 1, valueOfToken == 16.
const ZAAL = '0x7234c36A71ec237c2Ae7698e8916e0735001E9Af';

describe('packAwardTokenId / unpackAwardTokenId', () => {
  it('packs owner into the low 160 bits, period above, mintType on top', () => {
    const id = packAwardTokenId(ZAAL, 109, 10);
    expect(id & ((1n << 160n) - 1n)).toBe(BigInt(ZAAL));
    expect((id >> 160n) & ((1n << 64n) - 1n)).toBe(109n);
    expect(id >> 224n).toBe(10n);
  });

  it('round-trips through unpack, exposing both period and meeting', () => {
    const id = packAwardTokenId(ZAAL, meetingToPeriod(93), 10);
    const fields = unpackAwardTokenId(id);
    expect(fields.wallet).toBe(ZAAL.toLowerCase());
    expect(fields.period).toBe(92);
    expect(fields.meeting).toBe(93);
    expect(fields.mintType).toBe(10);
  });
});

describe('period <-> meeting (doc 2301: meeting = period + 1)', () => {
  it('converts both ways', () => {
    expect(periodToMeeting(92)).toBe(93);
    expect(meetingToPeriod(93)).toBe(92);
    expect(periodToMeeting(meetingToPeriod(110))).toBe(110);
  });
});

describe('meetingSearchRange', () => {
  it('probes the expected meeting first, then closest neighbours', () => {
    expect(meetingSearchRange(90, 2)).toEqual([90, 89, 91, 88, 92]);
  });

  it('defaults to MEETING_SEARCH_RADIUS', () => {
    expect(meetingSearchRange(90)).toHaveLength(1 + 2 * MEETING_SEARCH_RADIUS);
  });
});

describe('awardVerdict', () => {
  const award = (over: Partial<PendingAward> = {}): PendingAward => ({
    name: 'Joel',
    wallet: '0x570e563BA92589AD6b31f3269D24Cb21E5a45CaD',
    meeting: 90,
    amount: 110,
    ...over,
  });

  it('flags an unknown wallet as unverifiable', () => {
    expect(awardVerdict(award({ wallet: null }), [])).toContain('CANNOT VERIFY');
  });

  it('reports missing when nothing was minted nearby', () => {
    const v = awardVerdict(award(), []);
    expect(v).toContain('MISSING');
    expect(v).toContain('respectAccountBatch');
  });

  it('confirms an exact amount at the expected meeting', () => {
    const v = awardVerdict(award(), [{ meeting: 90, amount: 110, mintType: 10 }]);
    expect(v).toBe('ALREADY AWARDED - 110 at meeting 90');
  });

  it('confirms an exact amount at a shifted meeting number', () => {
    const v = awardVerdict(award(), [{ meeting: 89, amount: 110, mintType: 10 }]);
    expect(v).toBe('ALREADY AWARDED - 110 at meeting 89 (expected 90)');
  });

  it('prefers the exact-amount hit when a different award sits at the expected meeting', () => {
    // Penguin's real case: 26 minted at the expected meeting (weekly game
    // result), the owed 42 minted two meetings below (makeup batch).
    const v = awardVerdict(award({ name: 'Penguin', amount: 42 }), [
      { meeting: 88, amount: 42, mintType: 10 },
      { meeting: 90, amount: 26, mintType: 10 },
    ]);
    expect(v).toBe('ALREADY AWARDED - 42 at meeting 88 (expected 90)');
  });

  it('reports partial when amounts differ from the expected one', () => {
    const v = awardVerdict(award(), [{ meeting: 90, amount: 26, mintType: 10 }]);
    expect(v).toContain('PARTIAL');
    expect(v).toContain('expected 110');
  });

  it('treats any hit as awarded when the expected amount was unrecorded', () => {
    const v = awardVerdict(award({ amount: null }), [
      { meeting: 92, amount: 110, mintType: 10 },
    ]);
    expect(v).toContain('ALREADY AWARDED');
    expect(v).toContain('110 at meeting 92 (expected 90)');
  });
});
