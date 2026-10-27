export interface ChecklistTodo {
  ref: string;
  title: string;
  why: string;
  doneWhen: string;
  due: string;
}

export interface TodoBoardPort {
  exists(ref: string): Promise<boolean>;
  create(todo: ChecklistTodo): Promise<void>;
}

/** Ensure one todo per stable action ref. The source lookup must be exact; a
 * failed lookup is an error and callers must not proceed to create. */
export async function ensureChecklistTodos(
  todos: ChecklistTodo[],
  board: TodoBoardPort,
): Promise<string[]> {
  const created: string[] = [];
  for (const todo of todos) {
    if (await board.exists(todo.ref)) continue;
    await board.create(todo);
    created.push(todo.ref);
  }
  return created;
}
