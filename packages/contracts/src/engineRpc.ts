import {
  EngineAuthorizationDenied,
  EngineIdempotencyConflict,
  EngineNotFound,
  EngineRevisionConflict,
  EngineUnavailable,
  RunId,
  RunSpec,
  RunView,
} from "@t3tools/engine/contracts";
import { RunCommandRejected } from "@t3tools/engine/runs";
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Engine run RPCs; joined into WsRpcGroup, WS_METHODS and RPC_REQUIRED_SCOPES. */
export const ENGINE_WS_METHODS = {
  engineRunsCreate: "engine.runs.create",
  engineRunsGet: "engine.runs.get",
  engineRunsCancel: "engine.runs.cancel",
} as const;

export const EngineRpcError = Schema.Union([
  EngineAuthorizationDenied,
  EngineNotFound,
  EngineRevisionConflict,
  EngineIdempotencyConflict,
  EngineUnavailable,
  RunCommandRejected,
]);
export type EngineRpcError = typeof EngineRpcError.Type;

export const EngineRunsCreateInput = Schema.Struct({ spec: RunSpec });
export type EngineRunsCreateInput = typeof EngineRunsCreateInput.Type;
export const EngineRunsGetInput = Schema.Struct({ runId: RunId });
export type EngineRunsGetInput = typeof EngineRunsGetInput.Type;
export const EngineRunsCancelInput = Schema.Struct({
  runId: RunId,
  idempotencyKey: TrimmedNonEmptyString,
});
export type EngineRunsCancelInput = typeof EngineRunsCancelInput.Type;

export const WsEngineRunsCreateRpc = Rpc.make(ENGINE_WS_METHODS.engineRunsCreate, {
  payload: EngineRunsCreateInput,
  success: RunView,
  error: EngineRpcError,
});
export const WsEngineRunsGetRpc = Rpc.make(ENGINE_WS_METHODS.engineRunsGet, {
  payload: EngineRunsGetInput,
  success: RunView,
  error: EngineRpcError,
});
export const WsEngineRunsCancelRpc = Rpc.make(ENGINE_WS_METHODS.engineRunsCancel, {
  payload: EngineRunsCancelInput,
  success: RunView,
  error: EngineRpcError,
});
