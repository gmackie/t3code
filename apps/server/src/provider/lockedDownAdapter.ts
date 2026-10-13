import type { ModelSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import {
  ProviderAdapterProtocolError,
  type ProviderAdapterV2Shape,
} from "../orchestration-v2/ProviderAdapter.ts";

/** Guard every model-bearing operation, including settings changes after a session opens. */
export function restrictOpenCodeAdapter(
  adapter: ProviderAdapterV2Shape,
  allowed: ReadonlySet<string>,
): ProviderAdapterV2Shape {
  const check = (selection: ModelSelection | undefined) =>
    !selection || allowed.has(selection.model)
      ? Effect.void
      : Effect.fail(
          new ProviderAdapterProtocolError({
            driver: adapter.driver,
            detail: "Model is outside the configured Workers AI allowlist",
          }),
        );
  return {
    ...adapter,
    openSession: (input) =>
      check(input.modelSelection).pipe(
        Effect.andThen(Effect.suspend(() => adapter.openSession(input))),
        Effect.map((runtime) => ({
          ...runtime,
          ensureThread: (request) =>
            check(request.modelSelection).pipe(
              Effect.andThen(Effect.suspend(() => runtime.ensureThread(request))),
            ),
          resumeThread: (request) =>
            check(request.modelSelection).pipe(
              Effect.andThen(Effect.suspend(() => runtime.resumeThread(request))),
            ),
          forkThread: (request) =>
            check(request.modelSelection).pipe(
              Effect.andThen(Effect.suspend(() => runtime.forkThread(request))),
            ),
          startTurn: (request) =>
            check(request.modelSelection).pipe(
              Effect.andThen(Effect.suspend(() => runtime.startTurn(request))),
            ),
          ...(runtime.compactThread
            ? {
                compactThread: (
                  request: Parameters<NonNullable<typeof runtime.compactThread>>[0],
                ) =>
                  check(request.modelSelection).pipe(
                    Effect.andThen(Effect.suspend(() => runtime.compactThread!(request))),
                  ),
              }
            : {}),
        })),
      ),
  };
}
