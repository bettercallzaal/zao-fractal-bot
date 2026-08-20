import { describe, expect, it } from 'vitest';
import {
  bucketByMember,
  type ContributionRow,
  formatContributionDigest,
  MAX_CONTRIBUTION_LENGTH,
  normalizeContribution,
} from './contributions.js';

const row = (over: Partial<ContributionRow> = {}): ContributionRow => ({
  id: 'r1',
  discord_id: '111',
  display_name: 'Zaal',
  content: 'shipped the thing',
  links: [],
  meeting_number: null,
  reviewed: false,
  created_at: '2026-08-19T10:00:00Z',
  ...over,
});

describe('normalizeContribution', () => {
  it('trims and passes through clean text', () => {
    expect(normalizeContribution('  wrote the recap  ')).toEqual({
      content: 'wrote the recap',
      links: [],
    });
  });

  it('rejects empty text', () => {
    expect(() => normalizeContribution('   ')).toThrow(/empty/);
  });

  it('rejects over-long text with the limit in the message', () => {
    expect(() => normalizeContribution('x'.repeat(MAX_CONTRIBUTION_LENGTH + 1))).toThrow(
      new RegExp(String(MAX_CONTRIBUTION_LENGTH)),
    );
  });

  it('extracts unique links', () => {
    const { links } = normalizeContribution(
      'recap at https://example.com/a and video https://example.com/b, again https://example.com/a',
    );
    expect(links).toEqual(['https://example.com/a', 'https://example.com/b']);
  });
});

describe('bucketByMember', () => {
  it('groups by discord id and sorts busiest members first', () => {
    const buckets = bucketByMember([
      row({ id: 'a', discord_id: '222', display_name: 'Fellenz' }),
      row({ id: 'b' }),
      row({ id: 'c', discord_id: '222', display_name: 'Fellenz' }),
    ]);
    expect(buckets.map((b) => b.displayName)).toEqual(['Fellenz', 'Zaal']);
    expect(buckets[0].items).toHaveLength(2);
  });

  it('merges name-only rows case-insensitively', () => {
    const buckets = bucketByMember([
      row({ id: 'a', discord_id: null, display_name: 'jose' }),
      row({ id: 'b', discord_id: null, display_name: 'Jose' }),
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].items).toHaveLength(2);
  });

  it('orders items within a bucket chronologically', () => {
    const buckets = bucketByMember([
      row({ id: 'later', created_at: '2026-08-19T12:00:00Z' }),
      row({ id: 'earlier', created_at: '2026-08-18T12:00:00Z' }),
    ]);
    expect(buckets[0].items.map((i) => i.id)).toEqual(['earlier', 'later']);
  });
});

describe('formatContributionDigest', () => {
  it('says so when there is nothing to show', () => {
    expect(formatContributionDigest([])).toContain('No async contributions');
  });

  it('renders a member header with count and clipped one-line items', () => {
    const digest = formatContributionDigest(
      bucketByMember([
        row({ content: 'line one\nline two' }),
        row({ id: 'r2', content: 'y'.repeat(300) }),
      ]),
      { clipTo: 50 },
    );
    expect(digest).toContain('Zaal (2):');
    expect(digest).toContain('- line one line two');
    expect(digest).toContain('...');
    expect(digest.split('\n').every((l) => l.length < 60)).toBe(true);
  });

  it('uses the meeting number in the header when given', () => {
    const digest = formatContributionDigest(bucketByMember([row()]), { meetingNumber: 110 });
    expect(digest).toContain('meeting 110');
  });
});
