import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicLeaderboard } from './PublicLeaderboard.js';

describe('PublicLeaderboard', () => {
  it('never renders a Discord ID and displays a shortened wallet instead', () => {
    const discordId = '123456789012345678';
    const entry = {
      discordId,
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      weight: 42,
    };
    const html = renderToStaticMarkup(
      <PublicLeaderboard entries={[entry]} />,
    );

    expect(html).not.toContain(discordId);
    expect(html).not.toContain('Discord ID');
    expect(html).toContain('0x1234…5678');
    expect(html).toContain('Wallet');
  });
});
