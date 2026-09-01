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
