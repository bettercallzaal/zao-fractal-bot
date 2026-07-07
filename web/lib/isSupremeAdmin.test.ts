import { describe, expect, it } from 'vitest';
import { isSupremeAdmin } from './isSupremeAdmin.js';

describe('isSupremeAdmin', () => {
  it('returns true when the role list includes the Supreme Admin role', () => {
    expect(isSupremeAdmin(['111', '222'], '222')).toBe(true);
  });

  it('returns false when the role list does not include it', () => {
    expect(isSupremeAdmin(['111', '333'], '222')).toBe(false);
  });

  it('returns false for an empty role list', () => {
    expect(isSupremeAdmin([], '222')).toBe(false);
  });
});
