#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { OREC_EXECUTOR_ADDRESS, ZOR_RESPECT_ADDRESS } from '@fractalbot/shared';
import { makeOptimismClient, OREC_ABI } from '../src/lib/governance.js';
import { checklistMarkdown, readPassedUnexecuted } from '../src/lib/fractalChecklist.js';
import { paginateProposals, type OrnodeProposal } from '../src/lib/newcomers.js';
import { ensureChecklistTodos, type ChecklistTodo, type TodoBoardPort } from '../src/lib/todoCards.js';

const vault = process.env.ZAO_VAULT ?? join(process.env.HOME ?? '', 'zao-vault');
const output = process.env.FRACTAL_CHECKLIST_OUTPUT ?? join(vault, 'notes/fractal-checklist-latest.md');
const tracker = process.env.ZAO_TRACKER ?? join(process.env.HOME ?? '', 'bin/zao-tracker');
const meetingStartHour = Number(process.env.FRACTAL_MONDAY_HOUR_ET ?? '18');
const ornode = process.env.ZAO_ORNODE_URL ?? 'https://zao-ornode.frapps.xyz';

async function fetchAll(): Promise<OrnodeProposal[]> {
  return paginateProposals(async (spec) => {
    const response = await fetch(`${ornode}/v1/getProposals`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spec }),
    });
    if (!response.ok) throw new Error(`Ornode getProposals HTTP ${response.status}`);
    return ((await response.json()) as { proposals: OrnodeProposal[] }).proposals;
  }, 25, 50);
}

async function main(): Promise<void> {
  const proposals = await fetchAll();
  if (!proposals.length) throw new Error('Ornode returned zero proposals; refusing to treat an empty response as a clean checklist.');
  const client = makeOptimismClient();
  const pending = await readPassedUnexecuted(proposals, async (id) => {
    const exists = await client.readContract({ address: OREC_EXECUTOR_ADDRESS, abi: OREC_ABI, functionName: 'proposalExists', args: [id] });
    if (!exists) return { exists: false, stage: 'n/a', voteStatus: 'n/a' };
    const stage = await client.readContract({ address: OREC_EXECUTOR_ADDRESS, abi: OREC_ABI, functionName: 'getStage', args: [id] });
    return { exists: true, stage: ['Voting', 'Veto', 'Execution', 'Expired'][Number(stage)] ?? `Unknown(${stage})`, voteStatus: 'not needed' };
  });

  // Monday 18:00 ET is from the existing fractal knowledge/run-sheet. This
  // check is only due in the 24h after the latest Monday start.
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  monday.setHours(meetingStartHour, 0, 0, 0);
  const deadline = new Date(monday.getTime() + 24 * 60 * 60 * 1000);
  const withinWindow = now >= monday && now <= deadline;
  const period = Math.floor(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()) / 86400000); // date key only
  void period;
  let meetingCheck = 'Not due: the Monday 18:00 ET closeout window is outside the current 24 hours.';
  if (withinWindow) {
    const mondayDay = monday.toISOString().slice(0, 10);
    const from = Math.floor(monday.getTime() / 1000);
    const week = proposals.filter((p) => p.createTs >= from && p.createTs <= Math.floor(deadline.getTime() / 1000));
    const tick = week.find((p) => /tick/i.test(p.attachment?.propTitle ?? '') && p.content?.addr.toLowerCase() !== ZOR_RESPECT_ADDRESS.toLowerCase());
    const mints = week.filter((p) => p.content?.addr.toLowerCase() === ZOR_RESPECT_ADDRESS.toLowerCase());
    const misses = [!mints.length ? 'meeting mints' : '', !tick ? 'tick' : ''].filter(Boolean);
    meetingCheck = `Meeting date: ${mondayDay}; scheduled ${meetingStartHour}:00 ET; proposal scan window closes ${deadline.toISOString()}. Mints: ${mints.length ? `${mints.length} proposal(s) found` : 'NOT FOUND'}. Tick: ${tick ? `found ${tick.id}` : 'NOT FOUND'}. ${misses.length ? `Action due: propose ${misses.join(' and ')}.` : 'Both proposal types found.'}`;
  }

  const markdown = checklistMarkdown(now, pending, meetingCheck);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, markdown, 'utf8');
  console.log(markdown);

  // Stable exact-source lookups make daily runs idempotent. Do not create
  // cards for permanent NEVER EXECUTE items.
  const due: ChecklistTodo[] = pending.filter((p) => !p.neverExecute).map((item) => ({
    ref: `fractal-execute-${item.id.slice(2, 10).toLowerCase()}`,
    title: `Execute passed Fractal proposal ${item.id.slice(0, 10)}`,
    why: `${item.title}. OREC getStage=Execution. Review exact proposal before signing: ${item.executeUrl}`,
    doneWhen: 'Zaal verified proposal contents and either executed it or recorded why it should remain pending.',
    due: now.toISOString().slice(0, 10),
  }));
  const meetingDue = withinWindow && /Action due:/.test(meetingCheck);
  if (meetingDue) {
    due.push({
      ref: `fractal-closeout-${now.toISOString().slice(0, 10)}`,
      title: 'Complete Monday Fractal proposal closeout',
      why: meetingCheck,
      doneWhen: 'Meeting mints and tick proposals are both confirmed on Ornode and OREC.',
      due: now.toISOString().slice(0, 10),
    });
  }

  const board: TodoBoardPort = {
    async exists(ref) {
      const result = execFileSync(tracker, ['search', `inbox:${ref}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (/no related tasks found/i.test(result)) return false;
      if (/related tasks \(\d+\):/.test(result)) return true;
      throw new Error(`Unrecognized tracker search response for ${ref}; refusing duplicate-risk write.`);
    },
    async create(todo) {
      execFileSync(tracker, [
        'inbox', todo.ref, todo.title, 'owner=Zaal', `due=${todo.due}`,
        '--why', todo.why, '--done-when', todo.doneWhen,
      ], { stdio: 'inherit' });
    },
  };
  await ensureChecklistTodos(due, board);
}

main().catch((error) => { console.error(`zao-fractal-checklist: ${String(error)}`); process.exitCode = 1; });
