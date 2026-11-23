import { WS_METHODS } from "@t3tools/contracts";
import { bobOperationSchemas } from "@t3tools/contracts/bobContract";
import {
  planBelongsToProject,
  type GetCapabilitiesOutput,
  type GetPlanOutput,
  type ListPlansOutput,
} from "@t3tools/contracts/bobCoordination";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { request } from "../rpc/client.ts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

const outputDecoders = new Map(
  Array.from(bobOperationSchemas, ([operation, schemas]) => [
    operation,
    Schema.decodeUnknownEffect(schemas.output),
  ]),
);

const readBob = <A>(operation: string, input: unknown) =>
  request(WS_METHODS.serverBobCoordination, { operation, input }).pipe(
    Effect.flatMap((value) => outputDecoders.get(operation)!(value)),
    Effect.map((value) => value as A),
  );
export function createBobCoordinationAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
) {
  return {
    overview: createEnvironmentQueryAtomFamily(runtime, {
      label: "bob:work-overview",
      staleTimeMs: 1_000,
      execute: Effect.fn("bob.workOverview")(function* (input: { readonly projectId: string }) {
        const connection = yield* request(WS_METHODS.serverBobConnection, {});
        const binding = connection.projects[input.projectId];
        const [caps, page] = yield* Effect.all(
          [
            readBob<GetCapabilitiesOutput>("GetCapabilities", { contractVersion: "1" }),
            readBob<ListPlansOutput>("ListPlans", { contractVersion: "1", limit: 50 }),
          ],
          { concurrency: "unbounded" },
        );
        const scoped = yield* Effect.forEach(
          page.plans,
          (entry) =>
            readBob<GetPlanOutput>("GetPlan", {
              contractVersion: "1",
              resourceId: entry.planId,
            }).pipe(
              Effect.map((snapshot) =>
                binding && planBelongsToProject(snapshot.definition, binding) ? entry : null,
              ),
            ),
          { concurrency: "unbounded" },
        );
        return {
          caps,
          plans: scoped.filter((entry) => entry !== null),
          nextPlanId: page.nextPlanId ?? null,
        };
      }),
    }),
    connection: createEnvironmentRpcQueryAtomFamily(runtime, {
      tag: WS_METHODS.serverBobConnection,
      label: "bob:connection",
      staleTimeMs: 1000,
    }),
    call: createEnvironmentRpcCommand(runtime, {
      tag: WS_METHODS.serverBobCoordination,
      label: "bob:operation",
      concurrency: { mode: "parallel" },
    }),
  };
}
