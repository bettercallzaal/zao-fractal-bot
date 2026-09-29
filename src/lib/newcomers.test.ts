import { describe, expect, it } from 'vitest';
import {
  buildRoster,
  decodeAwardRecipients,
  diffNewcomers,
  type FetchProposalPage,
  type OrnodeProposal,
  paginateProposals,
} from './newcomers.js';

const ZOR = '0x9885CCeEf7E8371Bf8d6f2413723D25917E7445c';
const OREC = '0xcB05F9254765CA521F7698e61E0A6CA6456Be532';

// Real proposal from zao-ornode.frapps.xyz, fetched 2026-09-28: "AJ and PKMN
// intros for 117", 110 each, both wallets held 0 ZOR and 0 OG at the time.
const AJ_PKMN: OrnodeProposal = {
  id: '0x28c30412689b80868a3fee6cf814dd78f18ec4b1d6fcda9197b15d452743a398',
  content: {
    addr: ZOR,
    cdata:
      '0x5da7e1d4000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000020000000a0000000000000074e34a582682691f31ea4d08c133b3692ff0ebfa24000000000000000000000000000000000000000000000000000000000000006e0000000a00000000000000744bcee979fa5e984751f9d1dab4ecf50d134f2834000000000000000000000000000000000000000000000000000000000000006e0000000000000000000000000000000000000000000000000000000000000000',
  },
  attachment: {
    propType: 'respectAccountBatch',
    awards: [{ mintTitle: 'AJ intro for 117' }, { mintTitle: 'PKMN intro for 117' }],
  },
  createTs: 1790643521,
  status: 'NotExecuted',
};

// Real single-intro proposal (respectAccount -> mintRespect), executed.
const UNIQUE_BEING: OrnodeProposal = {
  id: '0xef44b3e281c395883f468e82f232a1d14fde815a3f08ee42fe7e635d06792aca',
  content: {
    addr: ZOR,
    cdata:
      '0xdfd469ed0000000a000000000000006f4c829f0a23766d5fab9c6ab4639e78028b57ff58000000000000000000000000000000000000000000000000000000000000006e00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000',
  },
  attachment: { propType: 'respectAccount', mintTitle: 'Intro for Unique Being for week 112' },
  createTs: 1787676263,
  status: 'Executed',
};

const TICK: OrnodeProposal = {
  id: '0x10a1',
  content: {
    addr: OREC,
    cdata:
      '0x141d51cb0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000017400000000000000000000000000000000000000000000000000000000000000',
  },
  createTs: 1790558941,
  status: 'NotExecuted',
};

describe('decodeAwardRecipients', () => {
  it('decodes wallets, values and meeting from real calldata', () => {
    const r = decodeAwardRecipients(AJ_PKMN, ZOR);
    expect(r).toEqual([
      { wallet: '0xe34a582682691f31ea4d08c133b3692ff0ebfa24', value: 110, meeting: 117, mintType: 10, title: 'AJ intro for 117' },
      { wallet: '0x4bcee979fa5e984751f9d1dab4ecf50d134f2834', value: 110, meeting: 117, mintType: 10, title: 'PKMN intro for 117' },
    ]);
  });

  it('decodes a single-recipient mintRespect intro', () => {
    expect(decodeAwardRecipients(UNIQUE_BEING, ZOR)).toEqual([
      { wallet: '0x4c829f0a23766d5fab9c6ab4639e78028b57ff58', value: 110, meeting: 112, mintType: 10, title: 'Intro for Unique Being for week 112' },
    ]);
  });

  it('ignores proposals that are not ZOR awards', () => {
    expect(decodeAwardRecipients(TICK, ZOR)).toEqual([]);
  });

  it('ignores proposals ornode holds without content', () => {
    expect(decodeAwardRecipients({ ...AJ_PKMN, content: undefined }, ZOR)).toEqual([]);
  });

  it('ignores ZOR proposals with calldata it cannot decode', () => {
    expect(decodeAwardRecipients({ ...AJ_PKMN, content: { addr: ZOR, cdata: '0xdeadbeef' } }, ZOR)).toEqual([]);
  });
});

describe('buildRoster', () => {
  it('records a first appearance per wallet, pending until executed', () => {
    const roster = buildRoster([AJ_PKMN, TICK], ZOR);
    expect(roster.size).toBe(2);
    const aj = roster.get('0xe34a582682691f31ea4d08c133b3692ff0ebfa24')!;
    expect(aj.firstMeeting).toBe(117);
    expect(aj.firstSeen).toBe('2026-09-29');
    expect(aj.firstStatus).toBe('NotExecuted');
    expect(aj.executedRespect).toBe(0);
  });

  it('promotes a pending first sighting once a later proposal executes', () => {
    const later = { ...AJ_PKMN, id: '0xlater', createTs: AJ_PKMN.createTs + 1, status: 'Executed' };
    const aj = buildRoster([later, AJ_PKMN], ZOR).get('0xe34a582682691f31ea4d08c133b3692ff0ebfa24')!;
    expect(aj.firstStatus).toBe('Executed');
    expect(aj.firstProposal).toBe('0xlater');
    expect(aj.proposals).toBe(2);
    expect(aj.executedRespect).toBe(110);
  });
});

describe('diffNewcomers', () => {
  it('returns only wallets the known list lacks, case-insensitively', () => {
    const roster = buildRoster([AJ_PKMN], ZOR);
    const fresh = diffNewcomers(roster, ['0xE34A582682691F31EA4D08C133B3692FF0EBFA24']);
    expect(fresh.map((m) => m.wallet)).toEqual(['0x4bcee979fa5e984751f9d1dab4ecf50d134f2834']);
  });
});

describe('paginateProposals', () => {
  /** Fake ornode with the live semantics: newest first, createTs < before. */
  function fakeOrnode(items: OrnodeProposal[]): FetchProposalPage {
    const sorted = [...items].sort((a, b) => b.createTs - a.createTs || b.id.localeCompare(a.id));
    return async ({ limit, before }) =>
      sorted.filter((p) => before === undefined || p.createTs < before).slice(0, limit);
  }
  const prop = (id: string, createTs: number): OrnodeProposal => ({ id, createTs, status: 'Executed' });

  it('returns every item exactly once when several share the page-boundary createTs', async () => {
    // Page size 4: first page is c,b,a3,a2 - a1 shares their createTs and
    // falls off the end of the page. A strict createTs cursor skips it.
    const items = [prop('c', 300), prop('b', 200), prop('a1', 100), prop('a2', 100), prop('a3', 100), prop('z', 50)];
    const got = await paginateProposals(fakeOrnode(items), 4);
    expect(got.map((p) => p.id).sort()).toEqual(['a1', 'a2', 'a3', 'b', 'c', 'z']);
  });

  it('refuses rather than drops when one second fills a whole page', async () => {
    const items = [prop('c', 300), prop('a1', 100), prop('a2', 100), prop('a3', 100), prop('z', 50)];
    await expect(paginateProposals(fakeOrnode(items), 3)).rejects.toThrow(/at least 3 proposals share createTs 100/);
  });

  it('stops on a short page', async () => {
    const got = await paginateProposals(fakeOrnode([prop('a', 2), prop('b', 1)]), 5);
    expect(got.map((p) => p.id)).toEqual(['a', 'b']);
  });
});
