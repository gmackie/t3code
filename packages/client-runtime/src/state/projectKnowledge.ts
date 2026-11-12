import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import * as Cause from "effect/Cause";
import { squashAtomCommandFailure, createEnvironmentRpcCommand } from "./runtime.ts";

export function createProjectKnowledgeCommands<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    search: createEnvironmentRpcCommand(runtime, {
      label: "knowledge:search",
      tag: WS_METHODS.projectKnowledgeSearch,
    }),
    read: createEnvironmentRpcCommand(runtime, {
      label: "knowledge:read",
      tag: WS_METHODS.projectKnowledgeRead,
    }),
    getNotes: createEnvironmentRpcCommand(runtime, {
      label: "knowledge:notes",
      tag: WS_METHODS.projectKnowledgeGetNotes,
    }),
    saveNotes: createEnvironmentRpcCommand(runtime, {
      label: "knowledge:save-notes",
      tag: WS_METHODS.projectKnowledgeSaveNotes,
    }),
  };
}

export function projectKnowledgeFailure(result: {
  readonly cause: Cause.Cause<unknown>;
}): string | null {
  if (Cause.hasInterruptsOnly(result.cause)) return null;
  const failure = squashAtomCommandFailure(result);
  return failure instanceof Error && failure.message.trim()
    ? failure.message
    : "Project knowledge did not answer. Try again; your draft has been kept.";
}
