import { describe, expect, it } from 'vitest';
import { type AsyncSubmission, eligibleAsyncEntrants } from './asyncEligibility.js';

const SESSION_START = Date.parse('2026-09-10T19:00:00Z');
const HOUR = 3_600_000;
const MINUTE = 60_000;

const sub = (id: string, offsetMs: number): AsyncSubmission => ({
  discordId: id,
  displayName: id,
  wallet: null,
  createdAtMs: SESSION_START - offsetMs,
});

const run = (submissions: AsyncSubmission[], intros: string[] = ['a', 'b', 'c', 'd']) =>
  eligibleAsyncEntrants({
    submissions,
    sessionStartMs: SESSION_START,
    introDiscordIds: new Set(intros),
  }).map((p) => p.discordId);

describe('the 12-hour window', () => {
  it('accepts a submission 11h59m before the session', () => {
    expect(run([sub('a', 11 * HOUR + 59 * MINUTE)])).toEqual(['a']);
  });

  it('rejects a submission 12h1m before the session', () => {
    expect(run([sub('a', 12 * HOUR + MINUTE)])).toEqual([]);
  });

  it('accepts a submission exactly on the boundary', () => {
    expect(run([sub('a', 12 * HOUR)])).toEqual(['a']);
  });

  it('rejects a submission made after the session started', () => {
    expect(run([sub('a', -MINUTE)])).toEqual([]);
  });
});

describe('the intro gate', () => {
  it('rejects someone with no intro on file', () => {
    expect(run([sub('z', HOUR)], ['a', 'b'])).toEqual([]);
  });

  it('resolves the gate at capture time, so a late intro does not qualify', () => {
    // The caller passes the intro set as it stood at session start. This test
    // pins the signature: there is no way to hand in a later set.
    expect(run([sub('a', HOUR)], [])).toEqual([]);
  });
});

describe('ordering and duplicates', () => {
  it('returns earliest submission first, because that is the deferral rule', () => {
    expect(run([sub('c', HOUR), sub('a', 5 * HOUR), sub('b', 3 * HOUR)])).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps one entry per person, their earliest in-window submission', () => {
    expect(run([sub('a', 2 * HOUR), sub('a', 6 * HOUR), sub('b', 4 * HOUR)])).toEqual([
      'a',
      'b',
    ]);
  });

  it('carries displayName and wallet through', () => {
    const out = eligibleAsyncEntrants({
      submissions: [
        { discordId: 'a', displayName: 'Alex', wallet: '0xabc', createdAtMs: SESSION_START - HOUR },
      ],
      sessionStartMs: SESSION_START,
      introDiscordIds: new Set(['a']),
    });
    expect(out).toEqual([{ discordId: 'a', displayName: 'Alex', wallet: '0xabc' }]);
  });
});
