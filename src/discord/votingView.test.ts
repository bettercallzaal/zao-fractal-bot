import { describe, expect, it } from 'vitest';
import { buildVotingRows, parseVoteButtonId, voteButtonId } from './votingView.js';

describe('vote button ids', () => {
  it('round trips a thread and candidate', () => {
    const id = voteButtonId('123', '456');
    expect(parseVoteButtonId(id)).toEqual({ threadId: '123', candidateDiscordId: '456' });
  });

  it('returns null for a customId from any other component', () => {
    expect(parseVoteButtonId('some_other_button')).toBeNull();
  });

  it('stays inside the Discord 100 character customId limit for real snowflakes', () => {
    expect(voteButtonId('1071292017117761616', '785782556896788521').length).toBeLessThanOrEqual(
      100,
    );
  });

  it('splits six candidates into two rows, since Discord allows five per row', () => {
    const candidates = Array.from({ length: 6 }, (_, i) => ({
      discordId: `u${i}`,
      displayName: `User ${i}`,
      wallet: null,
    }));
    expect(buildVotingRows('t', candidates)).toHaveLength(2);
  });

  it('truncates a long display name to the Discord button label limit', () => {
    const rows = buildVotingRows('t', [
      { discordId: 'u1', displayName: 'x'.repeat(200), wallet: null },
    ]);
    // The button component union includes an SKU variant that has no label,
    // so narrow rather than assuming.
    const component = rows[0].toJSON().components[0];
    const label = 'label' in component ? (component.label ?? '') : '';
    expect(label.length).toBe(80);
  });
});

describe('async entrants are visibly marked', () => {
  const candidates = ['v1', 'a1'].map((id) => ({
    discordId: id,
    displayName: id === 'a1' ? 'Async Alex' : 'Present Pat',
    wallet: null,
  }));

  it('labels an async candidate so nobody mistakes them for present', () => {
    const rows = buildVotingRows('t1', candidates, ['a1']);
    const labels = rows.flatMap((r) =>
      r.toJSON().components.map((c) => ('label' in c ? (c.label ?? '') : '')),
    );
    expect(labels).toContain('Present Pat');
    expect(labels).toContain('Async Alex (async)');
  });

  it('uses a different button style for async candidates', () => {
    const rows = buildVotingRows('t1', candidates, ['a1']);
    const styles = rows.flatMap((r) =>
      r.toJSON().components.map((c) => ('style' in c ? c.style : undefined)),
    );
    expect(new Set(styles).size).toBe(2);
  });

  it('keeps the label inside the Discord 80-character cap WITH the marker intact', () => {
    const long = [{ discordId: 'a1', displayName: 'x'.repeat(200), wallet: null }];
    const rows = buildVotingRows('t1', long, ['a1']);
    const component = rows[0].toJSON().components[0];
    const label = 'label' in component ? (component.label ?? '') : '';
    // Exact, not just a length bound. Truncating the concatenated string
    // instead of reserving room for the suffix would cut "(async)" in half
    // and still satisfy a length-only assertion.
    expect(label).toBe('x'.repeat(72) + ' (async)');
    expect(label.length).toBe(80);
  });

  it('is unchanged when no async ids are given', () => {
    const rows = buildVotingRows('t1', candidates);
    const labels = rows.flatMap((r) =>
      r.toJSON().components.map((c) => ('label' in c ? (c.label ?? '') : '')),
    );
    expect(labels).toEqual(['Present Pat', 'Async Alex']);
  });
});
