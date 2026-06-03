import type {
  TaskItem,
  TaskListInput,
  TaskPrepareThreadInput,
  TaskPrepareThreadResult,
  TaskProviderError,
  TaskProviderKind,
  TaskReference,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface TaskProviderShape {
  readonly kind: TaskProviderKind;
  readonly listTasks: (
    input: Omit<TaskListInput, "provider">,
  ) => Effect.Effect<ReadonlyArray<TaskItem>, TaskProviderError>;
  readonly getTask: (input: {
    readonly reference: TaskReference;
    readonly cwd?: string;
  }) => Effect.Effect<TaskItem, TaskProviderError>;
  readonly prepareTaskThread: (
    input: Omit<TaskPrepareThreadInput, "provider">,
  ) => Effect.Effect<TaskPrepareThreadResult, TaskProviderError>;
}

export class TaskProvider extends Context.Service<TaskProvider, TaskProviderShape>()(
  "t3/task/TaskProvider",
) {}
