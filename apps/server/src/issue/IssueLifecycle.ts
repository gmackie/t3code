import type {
  IssueLifecycleChangeRequest,
  IssueLifecycleUpdateResult,
  IssueProviderError,
  IssueProviderKind,
  IssueReference,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { IssueProviderRegistry } from "./IssueProviderRegistry.ts";

export interface IssueLifecycleTriggerInput {
  readonly provider: IssueProviderKind;
  readonly reference: IssueReference;
  readonly cwd: string;
}

export interface IssueLifecycleChangeRequestInput extends IssueLifecycleTriggerInput {
  readonly changeRequest: IssueLifecycleChangeRequest;
}

export interface IssueLifecycleShape {
  readonly recordThreadStarted: (
    input: IssueLifecycleTriggerInput,
  ) => Effect.Effect<IssueLifecycleUpdateResult, IssueProviderError>;
  readonly recordChangeRequestOpened: (
    input: IssueLifecycleChangeRequestInput,
  ) => Effect.Effect<IssueLifecycleUpdateResult, IssueProviderError>;
  readonly recordChangeRequestMerged: (
    input: IssueLifecycleChangeRequestInput,
  ) => Effect.Effect<IssueLifecycleUpdateResult, IssueProviderError>;
}

export class IssueLifecycle extends Context.Service<IssueLifecycle, IssueLifecycleShape>()(
  "t3/issue/IssueLifecycle",
) {}

export const make = Effect.fn("makeIssueLifecycle")(function* () {
  const registry = yield* IssueProviderRegistry;

  const update = (input: {
    readonly provider: IssueProviderKind;
    readonly reference: IssueReference;
    readonly cwd: string;
    readonly event: "thread_started" | "change_request_opened" | "change_request_merged";
    readonly changeRequest?: IssueLifecycleChangeRequest;
  }) =>
    registry.get(input.provider).pipe(
      Effect.flatMap((provider) =>
        provider.updateIssueLifecycle({
          reference: input.reference,
          cwd: input.cwd,
          event: input.event,
          ...(input.changeRequest ? { changeRequest: input.changeRequest } : {}),
        }),
      ),
    );

  return IssueLifecycle.of({
    recordThreadStarted: (input) =>
      update({
        ...input,
        event: "thread_started",
      }),
    recordChangeRequestOpened: (input) =>
      update({
        ...input,
        event: "change_request_opened",
      }),
    recordChangeRequestMerged: (input) =>
      update({
        ...input,
        event: "change_request_merged",
      }),
  });
});

export const layer = Layer.effect(IssueLifecycle, make());
