import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentSubscriptionAtomFamily,
} from "./runtime.ts";
import * as Stream from "effect/Stream";
import { subscribe, type EnvironmentRpcInput } from "../rpc/client.ts";
import { appendSerialChunk, EMPTY_SERIAL_OUTPUT } from "./serialOutput.ts";

export type { SerialOutputState } from "./serialOutput.ts";

/** All operations run on the connected environment, not on the browser device. */
export function createReverseEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "reverse:list",
      tag: WS_METHODS.reverseList,
      staleTimeMs: 1_000,
    }),
    toolchain: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "reverse:toolchain",
      tag: WS_METHODS.reverseToolchain,
      staleTimeMs: 30_000,
    }),
    importFile: createEnvironmentRpcCommand(runtime, {
      label: "reverse:import",
      tag: WS_METHODS.reverseImport,
    }),
    link: createEnvironmentRpcCommand(runtime, {
      label: "reverse:link",
      tag: WS_METHODS.reverseLink,
    }),
    publish: createEnvironmentRpcCommand(runtime, {
      label: "reverse:publish",
      tag: WS_METHODS.reversePublish,
    }),
    serialPorts: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "reverse:serial-ports",
      tag: WS_METHODS.reverseSerialPorts,
      staleTimeMs: 2_000,
    }),
    openSerial: createEnvironmentRpcCommand(runtime, {
      label: "reverse:serial-open",
      tag: WS_METHODS.reverseSerialOpen,
    }),
    writeSerial: createEnvironmentRpcCommand(runtime, {
      label: "reverse:serial-write",
      tag: WS_METHODS.reverseSerialWrite,
    }),
    closeSerial: createEnvironmentRpcCommand(runtime, {
      label: "reverse:serial-close",
      tag: WS_METHODS.reverseSerialClose,
    }),
    serialOutput: createEnvironmentSubscriptionAtomFamily(runtime, {
      label: "reverse:serial-observe",
      subscribe: (input: EnvironmentRpcInput<typeof WS_METHODS.reverseSerialObserve>) =>
        Stream.suspend(() =>
          subscribe(WS_METHODS.reverseSerialObserve, input).pipe(
            Stream.scan(() => EMPTY_SERIAL_OUTPUT, appendSerialChunk),
          ),
        ),
    }),
    importCapture: createEnvironmentRpcCommand(runtime, {
      label: "reverse:capture-import",
      tag: WS_METHODS.reverseCaptureImport,
    }),
    viewCapture: createEnvironmentRpcCommand(runtime, {
      label: "reverse:capture-view",
      tag: WS_METHODS.reverseCaptureView,
    }),
    decodeCapture: createEnvironmentRpcCommand(runtime, {
      label: "reverse:capture-decode",
      tag: WS_METHODS.reverseCaptureDecode,
    }),
    removeCapture: createEnvironmentRpcCommand(runtime, {
      label: "reverse:capture-delete",
      tag: WS_METHODS.reverseCaptureDelete,
    }),
    publishFinding: createEnvironmentRpcCommand(runtime, {
      label: "reverse:finding-publish",
      tag: WS_METHODS.reverseFindingPublish,
    }),
    diff: createEnvironmentRpcCommand(runtime, {
      label: "reverse:diff",
      tag: WS_METHODS.reverseDiff,
    }),
    importExtracted: createEnvironmentRpcCommand(runtime, {
      label: "reverse:import-extracted",
      tag: WS_METHODS.reverseImportExtracted,
    }),
    createFinding: createEnvironmentRpcCommand(runtime, {
      label: "reverse:finding-create",
      tag: WS_METHODS.reverseFindingCreate,
    }),
    updateFinding: createEnvironmentRpcCommand(runtime, {
      label: "reverse:finding-update",
      tag: WS_METHODS.reverseFindingUpdate,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "reverse:delete",
      tag: WS_METHODS.reverseDelete,
    }),
    analyze: createEnvironmentRpcCommand(runtime, {
      label: "reverse:analyze",
      tag: WS_METHODS.reverseAnalyze,
    }),
    emulate: createEnvironmentRpcCommand(runtime, {
      label: "reverse:emulate",
      tag: WS_METHODS.reverseEmulate,
    }),
    strings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "reverse:strings",
      tag: WS_METHODS.reverseStrings,
      staleTimeMs: 5_000,
    }),
  };
}
