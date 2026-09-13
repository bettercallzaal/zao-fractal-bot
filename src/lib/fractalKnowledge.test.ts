import { describe, expect, it } from 'vitest';
import { FRACTAL_KNOWLEDGE, findEntry, listTopics } from './fractalKnowledge.js';

describe('fractal knowledge base', () => {
  it('every entry has a unique key and non-empty body', () => {
    const keys = new Set<string>();
    for (const e of FRACTAL_KNOWLEDGE) {
      expect(e.key).toMatch(/^[a-z-]+$/);
      expect(keys.has(e.key)).toBe(false);
      keys.add(e.key);
      expect(e.body.length).toBeGreaterThan(20);
    }
  });

  it("every 'see' reference points to a real entry", () => {
    const keys = new Set(FRACTAL_KNOWLEDGE.map((e) => e.key));
    for (const e of FRACTAL_KNOWLEDGE) {
      for (const ref of e.see) expect(keys.has(ref)).toBe(true);
    }
  });

  it('follows brand rules: no emojis, no em dashes', () => {
    for (const e of FRACTAL_KNOWLEDGE) {
      const text = e.title + ' ' + e.body;
      expect(text).not.toMatch(/—/); // em dash
      expect(text).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u); // emoji ranges
    }
  });
});

describe('vote weight, as OREC actually computes it', () => {
  // MEASURED 2026-09-11 against @ordao/orec v1.4.4 Orec.sol and the deployed OREC at
  // 0xcB05F9254765CA521F7698e61E0A6CA6456Be532 on Optimism. `_vote()` calls
  // voteWeightOf(msg.sender) at the moment each voter casts, and the contract header says
  // it "does not know when respect of someone gets updated". There is no snapshot anywhere
  // in the code. The entry used to say weight was snapshotted at the block a proposal is
  // created, which is the kind of wrong answer a member would plan around: it implies
  // earning Respect mid-vote cannot help you, when in fact it can.
  const ledgers = FRACTAL_KNOWLEDGE.find((e) => e.key === 'ledgers');

  it('does not tell members their weight is snapshotted at proposal creation', () => {
    expect(ledgers).toBeDefined();
    expect(ledgers!.body.toLowerCase()).not.toMatch(/snapshot/);
  });

  it('says weight is read when the vote is cast', () => {
    expect(ledgers!.body.toLowerCase()).toMatch(/when you (vote|cast)|at the moment you vote/);
  });

  it('no entry anywhere claims a proposal-creation snapshot', () => {
    for (const e of FRACTAL_KNOWLEDGE) {
      expect(e.body.toLowerCase()).not.toMatch(/snapshot/);
    }
  });
});

describe('findEntry', () => {
  it('matches an exact key', () => {
    expect(findEntry('governance')?.key).toBe('governance');
  });

  it('matches an alias', () => {
    expect(findEntry('orec')?.key).toBe('governance');
    expect(findEntry('ideas')?.key).toBe('roadmap');
    expect(findEntry('og vs zor')?.key).toBe('ledgers');
  });

  it('is case- and punctuation-insensitive', () => {
    expect(findEntry('  OREC!! ')?.key).toBe('governance');
  });

  it('matches a substring of the title', () => {
    expect(findEntry('respect game')?.key).toBe('game');
  });

  it('falls back to a shared-token match', () => {
    expect(findEntry('how does voting work')?.key).toBe('governance');
  });

  it('returns null for an unrelated query', () => {
    expect(findEntry('pizza delivery')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(findEntry('   ')).toBeNull();
  });
});

describe('listTopics', () => {
  it('lists every topic with key and title', () => {
    const topics = listTopics();
    expect(topics.length).toBe(FRACTAL_KNOWLEDGE.length);
    expect(topics[0]).toHaveProperty('key');
    expect(topics[0]).toHaveProperty('title');
  });
});
