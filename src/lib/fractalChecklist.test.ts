import { describe, expect, it, vi } from 'vitest';
import { checklistMarkdown, readPassedUnexecuted } from './fractalChecklist.js';
import type { OrnodeProposal } from './newcomers.js';

const proposal = (id: string, status = 'NotExecuted'): OrnodeProposal => ({
  id, status, createTs: 1, attachment: { propTitle: 'Tick 120 to 121' },
});

describe('fractal checklist', () => {
  it('lists only OREC Execution stage proposals and carries exact proposal URLs', async () => {
    const read = vi.fn(async (id: `0x${string}`) => ({
      exists: true, stage: id.includes('2221') ? 'Execution' : 'Voting', voteStatus: 'Passed',
    }));
    const result = await readPassedUnexecuted([proposal('0x1111'), proposal('0x2221')], read);
    expect(result).toHaveLength(1);
    expect(result[0].executeUrl).toBe('https://zao.frapps.xyz/proposals/0x2221');
  });

  it('marks content-less proposal prefixes NEVER EXECUTE, regardless of stage', async () => {
    const read = vi.fn(async () => ({ exists: true, stage: 'Execution', voteStatus: 'Passed' }));
    const result = await readPassedUnexecuted([proposal('0x1c7dccd3abcd')], read);
    expect(result[0].neverExecute).toBe(true);
    expect(result[0].action).toBe('NEVER EXECUTE');
    expect(checklistMarkdown(new Date('2026-10-27T12:00:00Z'), result, 'pending').toLowerCase()).toContain('never execute');
  });

  it('does not mistake executed proposals for pending, even when OREC has deleted them', async () => {
    const read = vi.fn(async () => { throw new Error('getStage reverted'); });
    expect(await readPassedUnexecuted([proposal('0x3333', 'Executed')], read)).toEqual([]);
  });

  it('fails closed when Ornode says unexecuted but OREC stage cannot be read', async () => {
    const read = vi.fn(async () => { throw new Error('RPC timeout'); });
    await expect(readPassedUnexecuted([proposal('0x4444')], read)).rejects.toThrow('RPC timeout');
  });
});
