import type {
  AgentSessionSource,
  AgentSessionScanResult,
  AgentSessionScanError,
  AgentSessionImportSource,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as Stream from "effect/Stream";

export interface AgentSessionThreadMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
}

export interface AgentSessionThread {
  readonly source: AgentSessionSource;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerSessionId: string;
  readonly title: string;
  readonly model: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly messages: ReadonlyArray<AgentSessionThreadMessage>;
}

export type AgentSessionRecentThread =
  | {
      readonly _tag: "Importable";
      readonly thread: AgentSessionThread;
      readonly source: AgentSessionImportSource;
    }
  | { readonly _tag: "AlreadyImported"; readonly source: AgentSessionImportSource }
  | { readonly _tag: "Duplicate"; readonly source: AgentSessionImportSource }
  | { readonly _tag: "Skipped" };

/** Service tag for agent session discovery. */
export class AgentSessionScanner extends Context.Service<
  AgentSessionScanner,
  {
    /**
     * Discover every directory the configured Claude and Codex homes have run
     * a session in. Candidates are returned newest-first; the client decides
     * which ones to import and how far back to look. Fails with the contract
     * error directly — there is no server-local context worth wrapping.
     */
    readonly scan: Effect.Effect<AgentSessionScanResult, AgentSessionScanError>;
    readonly recentThreads: (
      workspaceRoot: string,
      completedSources?: ReadonlyArray<AgentSessionImportSource>,
    ) => Stream.Stream<AgentSessionRecentThread, AgentSessionScanError>;
  }
>()("t3/project/AgentSessionScanner") {}

const make = Effect.succeed(
  AgentSessionScanner.of({
    scan: DateTime.now.pipe(
      Effect.map((now) => ({ candidates: [], scannedAt: DateTime.formatIso(now) })),
    ),
    recentThreads: () => Stream.empty,
  }),
);
export const layer = Layer.effect(AgentSessionScanner, make);
