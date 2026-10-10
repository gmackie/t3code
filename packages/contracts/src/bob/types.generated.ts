// Generated from ForgeC OpenAPI by scripts/sync-bob-contract.mjs. Do not edit.
// SHA256: 2bd7537a2f41ba3c346d7f4ab5687060d633862a847651d5d0156c5eec0cc552
export type CancelExecutionInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly requestId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly thread: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly threadId: string;
    readonly turnId?: string | null;
  };
};
export type CancelExecutionOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type CancelItemInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly itemId: string;
  readonly expectedVersion: number;
};
export type CancelItemOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type ControlPlanInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly planId: string;
  readonly expectedVersion: number;
  readonly origin?: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly threadId?: string | null;
  } | null;
  readonly action: "start" | "pause" | "resume" | "cancel";
};
export type ControlPlanOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type CreatePlanInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly origin?: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly threadId?: string | null;
  } | null;
  readonly plan: {
    readonly items: ReadonlyArray<{
      readonly itemId: string;
      readonly issue: {
        readonly integrationId: string;
        readonly workspaceId: string;
        readonly teamId: string;
        readonly projectId: string;
        readonly issueId: string;
        readonly identifier?: string | null;
        readonly url?: string | null;
      };
      readonly target: {
        readonly environmentId: string;
        readonly projectId: string;
        readonly repository: { readonly integrationId: string; readonly repositoryId: string };
      };
      readonly issueSnapshotRef: string;
      readonly completionTarget: "execution" | "review-ready" | "merged" | "production";
    }>;
    readonly dependencies: ReadonlyArray<{
      readonly upstreamItemId: string;
      readonly downstreamItemId: string;
      readonly requiredMilestone:
        | "execution-succeeded"
        | "review-ready"
        | "merged"
        | "production-verified";
    }>;
    readonly concurrencyLimit: number;
  };
};
export type CreatePlanOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type FindExecutionInput = {
  readonly contractVersion: string;
  readonly requestId: string;
  readonly environmentId: string;
};
export type FindExecutionOutput = {
  readonly contractVersion: string;
  readonly requestId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly target: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly repository: { readonly integrationId: string; readonly repositoryId: string };
  };
  readonly thread: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly threadId: string;
    readonly turnId?: string | null;
  };
};
export type GetCapabilitiesInput = { readonly contractVersion: string };
export type GetCapabilitiesOutput = {
  readonly contractVersion: string;
  readonly operations: ReadonlyArray<string>;
  readonly executionProfiles: ReadonlyArray<string>;
  readonly validationProfiles: ReadonlyArray<string>;
  readonly eventResume: boolean;
  readonly durableExecutionAdmission: boolean;
};
export type GetItemInput = { readonly contractVersion: string; readonly resourceId: string };
export type GetItemOutput = {
  readonly contractVersion: string;
  readonly item: {
    readonly itemId: string;
    readonly planId: string;
    readonly resourceVersion: number;
    readonly state:
      | "pending"
      | "ready"
      | "reserved"
      | "running"
      | "waiting-input"
      | "execution-unknown"
      | "validating"
      | "review"
      | "deploying"
      | "failed"
      | "cancelling"
      | "cancelled"
      | "completed";
    readonly currentAttemptId?: string | null;
    readonly execution?: {
      readonly contractVersion: string;
      readonly requestId: string;
      readonly executionId: string;
      readonly attemptId: string;
      readonly target: {
        readonly environmentId: string;
        readonly projectId: string;
        readonly repository: { readonly integrationId: string; readonly repositoryId: string };
      };
      readonly thread: {
        readonly environmentId: string;
        readonly projectId: string;
        readonly threadId: string;
        readonly turnId?: string | null;
      };
    } | null;
    readonly achievedMilestones: ReadonlyArray<
      "execution-succeeded" | "review-ready" | "merged" | "production-verified"
    >;
    readonly operationIds: ReadonlyArray<string>;
    readonly evidenceRefs: ReadonlyArray<string>;
  };
  readonly eventCursor: string;
};
export type GetOperationInput = { readonly contractVersion: string; readonly resourceId: string };
export type GetOperationOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type GetPlanInput = { readonly contractVersion: string; readonly resourceId: string };
export type GetPlanOutput = {
  readonly contractVersion: string;
  readonly planId: string;
  readonly resourceVersion: number;
  readonly state: "draft" | "active" | "paused" | "cancelling" | "cancelled" | "completed";
  readonly definition: {
    readonly items: ReadonlyArray<{
      readonly itemId: string;
      readonly issue: {
        readonly integrationId: string;
        readonly workspaceId: string;
        readonly teamId: string;
        readonly projectId: string;
        readonly issueId: string;
        readonly identifier?: string | null;
        readonly url?: string | null;
      };
      readonly target: {
        readonly environmentId: string;
        readonly projectId: string;
        readonly repository: { readonly integrationId: string; readonly repositoryId: string };
      };
      readonly issueSnapshotRef: string;
      readonly completionTarget: "execution" | "review-ready" | "merged" | "production";
    }>;
    readonly dependencies: ReadonlyArray<{
      readonly upstreamItemId: string;
      readonly downstreamItemId: string;
      readonly requiredMilestone:
        | "execution-succeeded"
        | "review-ready"
        | "merged"
        | "production-verified";
    }>;
    readonly concurrencyLimit: number;
  };
  readonly items: ReadonlyArray<{
    readonly itemId: string;
    readonly resourceVersion: number;
    readonly state:
      | "pending"
      | "ready"
      | "reserved"
      | "running"
      | "waiting-input"
      | "execution-unknown"
      | "validating"
      | "review"
      | "deploying"
      | "failed"
      | "cancelling"
      | "cancelled"
      | "completed";
    readonly currentAttemptId?: string | null;
    readonly achievedMilestones: ReadonlyArray<
      "execution-succeeded" | "review-ready" | "merged" | "production-verified"
    >;
  }>;
  readonly eventCursor: string;
};
export type ListPlansInput = {
  readonly contractVersion: string;
  readonly afterPlanId?: string | null;
  readonly limit: number;
};
export type ListPlansOutput = {
  readonly contractVersion: string;
  readonly plans: ReadonlyArray<{
    readonly planId: string;
    readonly resourceVersion: number;
    readonly state: "draft" | "active" | "paused" | "cancelling" | "cancelled" | "completed";
    readonly itemCount: number;
  }>;
  readonly nextPlanId?: string | null;
};
export type ReadEventsInput = {
  readonly contractVersion: string;
  readonly cursor?: string | null;
  readonly limit: number;
};
export type ReadEventsOutput = {
  readonly contractVersion: string;
  readonly events: ReadonlyArray<{
    readonly eventId: string;
    readonly resourceId: string;
    readonly resourceVersion: number;
    readonly sequence: number;
    readonly recordedAt: string;
  }>;
  readonly nextCursor: string;
};
export type ReconcileItemInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly itemId: string;
};
export type ReconcileItemOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type RecordExecutionReceiptInput = {
  readonly contractVersion: string;
  readonly eventId: string;
  readonly environmentId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly outcome: "succeeded" | "failed" | "cancelled";
  readonly thread: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly threadId: string;
    readonly turnId?: string | null;
  };
  readonly sourceSnapshot: {
    readonly repository: { readonly integrationId: string; readonly repositoryId: string };
    readonly commitSha: string;
    readonly treeDigest: string;
    readonly dirty: boolean;
    readonly patchArtifactRef?: string | null;
    readonly toolchainDigest?: string | null;
    readonly checkProfileDigest?: string | null;
  };
  readonly evidenceRefs: ReadonlyArray<string>;
};
export type RecordExecutionReceiptOutput = {
  readonly contractVersion: string;
  readonly eventId: string;
  readonly acceptedSequence: number;
};
export type RecordProductionEvidenceInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly itemId: string;
  readonly stageRef: string;
  readonly deploymentId: string;
  readonly sourceRevision: string;
  readonly artifactDigest: string;
  readonly healthEvidenceRefs: ReadonlyArray<string>;
  readonly verifiedAt: string;
};
export type RecordProductionEvidenceOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type RecordValidationReceiptInput = {
  readonly contractVersion: string;
  readonly eventId: string;
  readonly environmentId: string;
  readonly attemptId: string;
  readonly validationId: string;
  readonly sequence: number;
  readonly sourceSnapshot: {
    readonly repository: { readonly integrationId: string; readonly repositoryId: string };
    readonly commitSha: string;
    readonly treeDigest: string;
    readonly dirty: boolean;
    readonly patchArtifactRef?: string | null;
    readonly toolchainDigest?: string | null;
    readonly checkProfileDigest?: string | null;
  };
  readonly checkProfileId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly exitCode: number;
  readonly outcome: "succeeded" | "failed" | "cancelled";
  readonly evidenceRefs: ReadonlyArray<string>;
};
export type RecordValidationReceiptOutput = {
  readonly contractVersion: string;
  readonly eventId: string;
  readonly acceptedSequence: number;
};
export type RequestDeploymentInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly itemId: string;
  readonly action: "deploy" | "promote" | "rollback";
  readonly artifactRef: string;
  readonly stageRef: string;
  readonly deploymentRef?: string | null;
};
export type RequestDeploymentOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type RequestExecutionInput = {
  readonly contractVersion: string;
  readonly requestId: string;
  readonly attemptId: string;
  readonly itemId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly issueSnapshotRef: string;
  readonly target: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly repository: { readonly integrationId: string; readonly repositoryId: string };
  };
  readonly work: {
    readonly title: string;
    readonly instructions: string;
    readonly acceptanceCriteria: ReadonlyArray<string>;
  };
  readonly workspace: { readonly baseRevision: string; readonly branch: string };
  readonly executionProfileId: string;
};
export type RequestExecutionOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type RequestReleaseInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly attemptId: string;
  readonly action: "open-pr" | "approve" | "merge";
  readonly sourceRevision: string;
  readonly pullRequestRef?: string | null;
};
export type RequestReleaseOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type RequestValidationInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly attemptId: string;
  readonly target: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly repository: { readonly integrationId: string; readonly repositoryId: string };
  };
  readonly sourceSnapshot: {
    readonly repository: { readonly integrationId: string; readonly repositoryId: string };
    readonly commitSha: string;
    readonly treeDigest: string;
    readonly dirty: boolean;
    readonly patchArtifactRef?: string | null;
    readonly toolchainDigest?: string | null;
    readonly checkProfileDigest?: string | null;
  };
  readonly checkProfileId: string;
};
export type RequestValidationOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type ResolveInputInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly attemptId: string;
  readonly promptId: string;
  readonly answer: string;
};
export type ResolveInputOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type RetryItemInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly itemId: string;
  readonly expectedVersion: number;
  readonly previousAttemptId: string;
  readonly reason: string;
};
export type RetryItemOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type SubmitExecutionInput = {
  readonly contractVersion: string;
  readonly requestId: string;
  readonly attemptId: string;
  readonly itemId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly issueSnapshotRef: string;
  readonly target: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly repository: { readonly integrationId: string; readonly repositoryId: string };
  };
  readonly work: {
    readonly title: string;
    readonly instructions: string;
    readonly acceptanceCriteria: ReadonlyArray<string>;
  };
  readonly workspace: { readonly baseRevision: string; readonly branch: string };
  readonly executionProfileId: string;
};
export type SubmitExecutionOutput = {
  readonly contractVersion: string;
  readonly requestId: string;
  readonly executionId: string;
  readonly attemptId: string;
  readonly target: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly repository: { readonly integrationId: string; readonly repositoryId: string };
  };
  readonly thread: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly threadId: string;
    readonly turnId?: string | null;
  };
};
export type TriggerPlanInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly planId: string;
  readonly planVersion: number;
  readonly scheduleId: string;
  readonly occurrenceId: string;
  readonly scheduledAt: string;
  readonly overlapPolicy: "skip";
};
export type TriggerPlanOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
export type UpdatePlanInput = {
  readonly contractVersion: string;
  readonly commandId: string;
  readonly planId: string;
  readonly expectedVersion: number;
  readonly origin?: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly threadId?: string | null;
  } | null;
  readonly plan: {
    readonly items: ReadonlyArray<{
      readonly itemId: string;
      readonly issue: {
        readonly integrationId: string;
        readonly workspaceId: string;
        readonly teamId: string;
        readonly projectId: string;
        readonly issueId: string;
        readonly identifier?: string | null;
        readonly url?: string | null;
      };
      readonly target: {
        readonly environmentId: string;
        readonly projectId: string;
        readonly repository: { readonly integrationId: string; readonly repositoryId: string };
      };
      readonly issueSnapshotRef: string;
      readonly completionTarget: "execution" | "review-ready" | "merged" | "production";
    }>;
    readonly dependencies: ReadonlyArray<{
      readonly upstreamItemId: string;
      readonly downstreamItemId: string;
      readonly requiredMilestone:
        | "execution-succeeded"
        | "review-ready"
        | "merged"
        | "production-verified";
    }>;
    readonly concurrencyLimit: number;
  };
};
export type UpdatePlanOutput = {
  readonly contractVersion: string;
  readonly operationId: string;
  readonly commandId: string;
  readonly state: "accepted" | "running" | "succeeded" | "failed" | "cancelled";
  readonly resourceId: string;
  readonly resourceVersion: number;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
};
