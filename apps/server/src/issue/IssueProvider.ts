import type {
  IssueItem,
  IssueLifecycleUpdateInput,
  IssueLifecycleUpdateResult,
  IssueListInput,
  IssuePrepareThreadInput,
  IssuePrepareThreadResult,
  IssueProviderError,
  IssueProviderKind,
  IssueReference,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface IssueProviderShape {
  readonly kind: IssueProviderKind;
  readonly listIssues: (
    input: Omit<IssueListInput, "provider">,
  ) => Effect.Effect<ReadonlyArray<IssueItem>, IssueProviderError>;
  readonly getIssue: (input: {
    readonly reference: IssueReference;
    readonly cwd?: string;
  }) => Effect.Effect<IssueItem, IssueProviderError>;
  readonly prepareIssueThread: (
    input: Omit<IssuePrepareThreadInput, "provider">,
  ) => Effect.Effect<IssuePrepareThreadResult, IssueProviderError>;
  readonly updateIssueLifecycle: (
    input: Omit<IssueLifecycleUpdateInput, "provider">,
  ) => Effect.Effect<IssueLifecycleUpdateResult, IssueProviderError>;
}

export class IssueProvider extends Context.Service<IssueProvider, IssueProviderShape>()(
  "t3/issue/IssueProvider",
) {}
