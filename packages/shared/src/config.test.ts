import { describe, expect, it } from 'vitest';
import {
  ASYNC_WINDOW_HOURS,
  MAX_GROUP_MEMBERS,
  MIN_GROUP_MEMBERS,
  MIN_VOTERS,
  RESPECT_POINTS,
} from './config.js';

describe('async participation constants', () => {
  it('MIN_VOTERS is 3', () => {
    expect(MIN_VOTERS).toBe(3);
  });

  it('MIN_VOTERS is distinct from MIN_GROUP_MEMBERS', () => {
    // They answer different questions: MIN_GROUP_MEMBERS is how few people can
    // play at all, MIN_VOTERS is how few can be trusted to rank an absent
    // person. Spec 3.2 requires they never be collapsed into one constant.
    expect(MIN_VOTERS).not.toBe(MIN_GROUP_MEMBERS);
  });

  it('the ladder still fits the cap', () => {
    expect(RESPECT_POINTS.length).toBe(MAX_GROUP_MEMBERS);
  });

  it('ASYNC_WINDOW_HOURS is 12', () => {
    expect(ASYNC_WINDOW_HOURS).toBe(12);
  });
});
