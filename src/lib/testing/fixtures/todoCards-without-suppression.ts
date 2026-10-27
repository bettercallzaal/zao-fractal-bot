import type { ChecklistTodo, TodoBoardPort } from '../../todoCards.js';

/** Pre-fix artifact for the duplicate-card red control: always writes, even
 * when the stable source ref already exists. Kept separate from production. */
export async function ensureChecklistTodosWithoutSuppression(
  todos: ChecklistTodo[],
  board: TodoBoardPort,
): Promise<string[]> {
  const created: string[] = [];
  for (const todo of todos) {
    await board.create(todo);
    created.push(todo.ref);
  }
  return created;
}
