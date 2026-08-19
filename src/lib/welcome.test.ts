import { describe, expect, it } from 'vitest';
import { buildWelcomeMessage } from './welcome.js';

describe('buildWelcomeMessage', () => {
  it('greets by name and lists the four onboarding steps in order', () => {
    const msg = buildWelcomeMessage({ displayName: 'Candy', hasWallet: false });
    expect(msg).toContain('Welcome, Candy.');
    const order = ['1. Register your wallet', '2. Post your intro', '3. Show up', '4. Tell your circle'];
    let last = -1;
    for (const step of order) {
      const at = msg.indexOf(step);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });

  it('marks the wallet step done for a bound member', () => {
    const msg = buildWelcomeMessage({ displayName: 'Zaal', hasWallet: true });
    expect(msg).toContain('Register your wallet [DONE]');
    expect(msg).not.toContain('Post your intro [DONE]');
  });

  it('marks the intro step done when known', () => {
    const msg = buildWelcomeMessage({ displayName: 'Zaal', hasWallet: true, hasIntro: true });
    expect(msg).toContain('Post your intro [DONE]');
  });

  it('never marks steps done for a brand-new member', () => {
    const msg = buildWelcomeMessage({ displayName: 'New', hasWallet: false, hasIntro: false });
    expect(msg).not.toContain('[DONE]');
  });

  it('points at the async path and the whitepaper', () => {
    const msg = buildWelcomeMessage({ displayName: 'New', hasWallet: false });
    expect(msg).toContain('Cannot make Mondays?');
    expect(msg).toContain('zaofractal.vercel.app');
  });

  it('stays inside one Discord message', () => {
    const msg = buildWelcomeMessage({ displayName: 'A'.repeat(32), hasWallet: false });
    expect(msg.length).toBeLessThan(2000);
  });
});
