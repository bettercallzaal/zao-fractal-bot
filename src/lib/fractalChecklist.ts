import type { OrnodeProposal } from './newcomers.js';

export const NEVER_EXECUTE = new Set([
  '0x1c7dccd3',
  '0x55e992ec',
]);

export interface StageReader {
  (id: `0x${string}`): Promise<{ exists: boolean; stage: string; voteStatus: string }>;
}

export interface ChecklistItem {
  id: string;
  title: string;
  stage: string;
  action: string;
  executeUrl: string;
  neverExecute: boolean;
}

function describe(proposal: OrnodeProposal): string {
  const title = proposal.attachment?.propTitle ?? proposal.attachment?.mintTitle ?? proposal.attachment?.propType ?? 'Proposal content unavailable';
  const awards = proposal.attachment?.awards;
  if (awards?.length) return `${title} — ${awards.map((a) => a.mintTitle ?? a.mintReason ?? 'unnamed award').join('; ')}`;
  return title;
}

export async function readPassedUnexecuted(
  proposals: OrnodeProposal[],
  readStage: StageReader,
): Promise<ChecklistItem[]> {
  const out: ChecklistItem[] = [];
  for (const proposal of proposals) {
    const id = proposal.id.toLowerCase();
    const isExecuted = Boolean(proposal.executeTxHash) || proposal.status === 'Executed';
    if (isExecuted) continue;
    // The caller checks proposalExists before getStage. A missing OREC record
    // is therefore an explicit exclusion; any read error here is ambiguous
    // and must stop the report rather than silently hide a passed proposal.
    const state = await readStage(proposal.id as `0x${string}`);
    if (!state.exists || state.stage !== 'Execution') continue;
    const unsafe = [...NEVER_EXECUTE].some((bad) => id.startsWith(bad));
    out.push({
      id: proposal.id,
      title: describe(proposal),
      stage: state.stage,
      action: unsafe ? 'NEVER EXECUTE' : `Open proposal, verify its contents, click Execute, then confirm in your wallet.`,
      executeUrl: unsafe ? 'NEVER EXECUTE' : `https://zao.frapps.xyz/proposals/${proposal.id}`,
      neverExecute: unsafe,
    });
  }
  return out;
}

export function checklistMarkdown(now: Date, items: ChecklistItem[], meetingCheck: string): string {
  const rows = items.length
    ? items.map((p) => `| ${p.id} | ${p.title.replaceAll('|', '\\|')} | ${p.stage} | ${p.neverExecute ? '**NEVER EXECUTE**' : `[Open ${p.id.slice(0, 10)}](${p.executeUrl}) → click **Execute** and confirm in wallet`} |`).join('\n')
    : '| none | No proposals confirmed as passed and unexecuted | — | — |';
  return `# Fractal proposal checklist — ${now.toISOString()}\n\nRead-only snapshot. OREC \`getStage\` supplies every listed stage; Ornode supplies proposal content and execution corroboration.\n\n## Monday meeting closeout (within 24 hours)\n\n${meetingCheck}\n\n## Passed, not executed\n\n| Proposal id | What it does | OREC stage | Exact zao.frapps.xyz action |\n|---|---|---|---|\n${rows}\n\n## Permanent execution blocks\n\n- \`0x1c7dccd3\` — **NEVER EXECUTE** (content-less proposal).\n- \`0x55e992ec\` — **NEVER EXECUTE** (content-less proposal).\n`;
}
