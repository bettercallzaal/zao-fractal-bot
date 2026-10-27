import { describe, expect, it } from 'vitest';
import { ensureChecklistTodos, type ChecklistTodo, type TodoBoardPort } from './todoCards.js';
import { ensureChecklistTodosWithoutSuppression } from './testing/fixtures/todoCards-without-suppression.js';

const due: ChecklistTodo[] = [
  { ref: 'fractal-execute-aaaa1111', title: 'Execute proposal A', why: 'Passed', doneWhen: 'Handled', due: '2026-10-27' },
  { ref: 'fractal-execute-bbbb2222', title: 'Execute proposal B', why: 'Passed', doneWhen: 'Handled', due: '2026-10-27' },
];

function memoryBoard(): TodoBoardPort & { cards: Map<string, ChecklistTodo> } {
  const cards = new Map<string, ChecklistTodo>();
  return {
    cards,
    async exists(ref) { return cards.has(ref); },
    async create(todo) { cards.set(todo.ref, todo); },
  };
}

async function expectSecondRunCreatesNothing(
  run: typeof ensureChecklistTodos,
): Promise<void> {
  const board = memoryBoard();
  expect(await run(due, board)).toEqual(due.map((todo) => todo.ref));
  expect(await run(due, board)).toEqual([]);
  expect(board.cards.size).toBe(2);
}

describe('ensureChecklistTodos', () => {
  it('creates due action cards once and suppresses all duplicates on the second run', async () => {
    await expectSecondRunCreatesNothing(ensureChecklistTodos);
  });

  it('red control: the same idempotence assertion fails against a separate pre-fix artifact', async () => {
    await expect(expectSecondRunCreatesNothing(ensureChecklistTodosWithoutSuppression)).rejects.toThrow();
  });
});
