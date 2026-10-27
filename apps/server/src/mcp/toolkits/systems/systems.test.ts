import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  type Project,
  ProviderInstanceId,
  type OrchestrationV2ThreadShell,
  type SystemsCapability,
  SystemsCapabilitiesResult,
  SystemsCompileResult,
  SystemsDiagnostic,
  SystemsModelPatchResult,
  SystemsModelReadResult,
  SystemsRun,
  SystemsRunCompareResult,
  SystemsRunEventsResult,
  SystemsRunListResult,
  SystemsRunSignalsResult,
  SystemsValidateResult,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/ai";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../../../persistence/Sqlite.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as SystemsService from "../../../systems/SystemsService.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import { systemsAuthority } from "./authority.ts";

const FIXTURES = new URL(
  "../../../../../../packages/systems-model/fixtures/conformance-v0.1/",
  import.meta.url,
);
const PUMP_RUN = "experiments/pump-nominal.run.json";
const PUMP_SYSTEM = "models/pump.system.json";
const PUMP_LAYOUT = "models/pump.layout.json";
const projectA = ProjectId.make("project-a");
const projectB = ProjectId.make("project-b");

const thread = (
  id: string,
  modes: Parameters<typeof liveThreadShell>[1],
  extra: Partial<OrchestrationV2ThreadShell> = {},
): OrchestrationV2ThreadShell => ({
  ...liveThreadShell(ThreadId.make(id), modes),
  projectId: projectA,
  ...extra,
});

const shells = new Map(
  [
    thread("editor", { runtimeMode: "auto-accept-edits" }),
    thread("full", { runtimeMode: "full-access" }),
    thread("planner", { runtimeMode: "full-access", interactionMode: "plan" }),
    thread("supervised", { runtimeMode: "approval-required" }),
    thread("elsewhere", { runtimeMode: "auto-accept-edits" }, { projectId: projectB }),
    // A delegated child of `full`, started below its parent's modes.
    thread(
      "child",
      { runtimeMode: "approval-required" },
      {
        lineage: {
          rootThreadId: ThreadId.make("full"),
          parentThreadId: ThreadId.make("full"),
          relationshipToParent: "subagent",
        },
      },
    ),
  ].map((shell) => [shell.id, shell] as const),
);

const threadsLayer = Layer.mock(ThreadManagement.ThreadManagementService)({
  getThreadShell: (id) => Effect.succeed(shells.get(id) ?? null),
});

type Scope = McpInvocationContext.McpInvocationScope;
const base = {
  environmentId: EnvironmentId.make("environment"),
  capabilities: new Set(["orchestration"] as const),
  issuedAt: 0,
};
const asThread = (id: string, subagent = false): Scope => ({
  ...base,
  requestNamespace: `provider:${id}`,
  thread: {
    threadId: ThreadId.make(id),
    providerSessionId: `provider:${id}`,
    providerInstanceId: ProviderInstanceId.make("codex"),
    ...(subagent ? { subagent: true } : {}),
  },
  client: undefined,
});
const asClient = (
  access: McpInvocationContext.McpClientCaller["access"],
  linked = false,
): Scope => ({
  ...base,
  requestNamespace: "client:session",
  thread: undefined,
  client: { sessionId: "session", label: "Laptop", access, linked },
});

const mcpClient = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "systems-test", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "systems-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const projects = (roots: Readonly<Record<string, string>>) =>
  Layer.mock(ProjectService.ProjectService)({
    getById: (id) =>
      Effect.succeed(
        Option.fromNullishOr(
          roots[id] === undefined ? undefined : ({ id, workspaceRoot: roots[id] } as Project),
        ),
      ),
  });

/** Project A holds the conformance pack under `sw/`; B is empty. */
const workspace = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
  const rootA = path.join(root, "a");
  const rootB = path.join(root, "b");
  yield* fs.makeDirectory(rootB, { recursive: true });
  yield* fs.copy(yield* path.fromFileUrl(FIXTURES), path.join(rootA, "sw"));
  const source = (file: string) => fs.readFileString(path.join(rootA, "sw", file));
  return { rootA, rootB, source };
});

const tools = (
  roots: Readonly<Record<string, string>>,
  options: SystemsService.SystemsServiceOptions = {},
) =>
  McpHttpServer.layerSystemsRegistration.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provideMerge(
      Layer.effect(
        SystemsService.SystemsService,
        SystemsService.make({ chunkBoundaries: 4, ...options }),
      ).pipe(Layer.provide(projects(roots))),
    ),
    Layer.provideMerge(threadsLayer),
  );

const call = (scope: Scope, name: string, args: Record<string, unknown>) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) => server.callTool({ name, arguments: args })),
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    Effect.provideService(McpSchema.McpServerClient, mcpClient),
  );

const ok = <S extends Schema.Decoder<unknown>>(
  schema: S,
  scope: Scope,
  name: string,
  args: Record<string, unknown>,
) =>
  call(scope, name, args).pipe(
    Effect.map((result) => {
      assert.isFalse(result.isError === true, `${name}: ${JSON.stringify(result.content)}`);
      return Schema.decodeSync(schema)(result.structuredContent);
    }),
  );

const decodeFailure = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      code: Schema.optionalKey(Schema.String),
      reason: Schema.optionalKey(Schema.String),
      diagnostics: Schema.optionalKey(Schema.Array(SystemsDiagnostic)),
    }),
  ),
);
const failure = (scope: Scope, name: string, args: Record<string, unknown>) =>
  call(scope, name, args).pipe(
    Effect.map((result) => {
      assert.isTrue(result.isError === true, name);
      const text = result.content[0];
      return decodeFailure(text?.type === "text" ? text.text : "");
    }),
  );

const project = { projectId: projectA, path: "sw" };
const editor = asThread("editor");

const layer = Layer.mergeAll(
  NodeServices.layer,
  SqlitePersistence.layerMemory.pipe(Layer.provide(NodeServices.layer)),
);

const digestOf = Effect.fn(function* (scope: Scope) {
  const compiled = yield* ok(SystemsCompileResult, scope, "t3_systems_compile", {
    ...project,
    entry: PUMP_SYSTEM,
  });
  return compiled.entries[0]?.semanticDigest;
});

const revisionOf = Effect.fn(function* (file: string) {
  return (yield* ok(SystemsModelReadResult, editor, "t3_systems_model_read", { ...project, file }))
    .revision;
});

describe("systems MCP toolkit", () => {
  it.effect("validates, compiles and runs the pump fixture through the service", () =>
    Effect.gen(function* () {
      const { rootA } = yield* workspace;
      yield* Effect.gen(function* () {
        const validated = yield* ok(SystemsValidateResult, editor, "t3_systems_validate", {
          ...project,
          experiments: [PUMP_RUN],
        });
        assert.include(validated.experiments, PUMP_RUN);
        assert.deepStrictEqual(validated.diagnostics, []);
        assert.match((yield* digestOf(editor)) ?? "", /^sha256:/);

        const created = yield* ok(SystemsRun, editor, "t3_systems_run_create", {
          ...project,
          experimentRef: PUMP_RUN,
          idempotencyKey: "pump",
        });
        assert.strictEqual(created.status, "queued");
        const ref = { projectId: projectA, runId: created.runId };
        const waited = yield* ok(SystemsRun, editor, "t3_systems_run_wait", ref);
        assert.strictEqual(waited.status, "completed");
        assert.strictEqual(
          (yield* ok(SystemsRun, editor, "t3_systems_run_get", ref)).status,
          "completed",
        );
        assert.lengthOf(
          (yield* ok(SystemsRunListResult, editor, "t3_systems_run_list", { projectId: projectA }))
            .runs,
          1,
        );

        const first = yield* ok(SystemsRunEventsResult, editor, "t3_systems_run_events", {
          ...ref,
          limit: 5,
        });
        assert.lengthOf(first.events, 5);
        assert.isTrue(first.hasMore);
        const second = yield* ok(SystemsRunEventsResult, editor, "t3_systems_run_events", {
          ...ref,
          fromSequence: first.nextSequence,
          limit: 5,
        });
        assert.strictEqual(second.events[0]?.sequence, first.nextSequence);
        // The default page stays small however long the run is.
        const page = yield* ok(SystemsRunEventsResult, editor, "t3_systems_run_events", ref);
        assert.strictEqual(page.events.length, Math.min(50, waited.eventCount));

        const signals = yield* ok(SystemsRunSignalsResult, editor, "t3_systems_run_signals", {
          ...ref,
          signalIds: ["level"],
        });
        assert.isAtMost(signals.series[0]?.points.length ?? 0, 200);
        assert.deepStrictEqual(
          (yield* ok(SystemsRunCompareResult, editor, "t3_systems_run_compare", ref)).mismatches,
          [],
        );
      }).pipe(Effect.provide(tools({ [projectA]: rootA })));
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("writes a valid patch and reports its semantic diff", () =>
    Effect.gen(function* () {
      const { rootA, source } = yield* workspace;
      yield* Effect.gen(function* () {
        const before = yield* digestOf(editor);
        const revision = yield* revisionOf(PUMP_SYSTEM);
        const patched = yield* ok(SystemsModelPatchResult, editor, "t3_systems_model_patch", {
          ...project,
          file: PUMP_SYSTEM,
          expectedRevision: revision,
          operations: [{ op: "replace", path: "/nodes/0/parameters/value", value: 2 }],
        });
        assert.strictEqual(patched.status, "written");
        assert.strictEqual(patched.previousRevision, revision);
        assert.deepStrictEqual(patched.semanticDiff?.changes.parameters?.changed, ["inlet.value"]);
        assert.notStrictEqual(
          patched.semanticDiff?.beforeDigest,
          patched.semanticDiff?.afterDigest,
        );
        assert.strictEqual(yield* revisionOf(PUMP_SYSTEM), patched.revision);
        assert.strictEqual(JSON.parse(yield* source(PUMP_SYSTEM)).nodes[0].parameters.value, 2);
        assert.notStrictEqual(yield* digestOf(editor), before);
      }).pipe(Effect.provide(tools({ [projectA]: rootA })));
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("writes nothing on a stale revision, an error, or a dry run", () =>
    Effect.gen(function* () {
      const { rootA, source } = yield* workspace;
      yield* Effect.gen(function* () {
        const original = yield* source(PUMP_SYSTEM);
        const revision = yield* revisionOf(PUMP_SYSTEM);
        const patch = (operations: ReadonlyArray<unknown>, extra = {}) => ({
          ...project,
          file: PUMP_SYSTEM,
          expectedRevision: revision,
          operations,
          ...extra,
        });
        const valid = [{ op: "replace", path: "/nodes/0/parameters/value", value: 2 }];

        const stale = yield* failure(editor, "t3_systems_model_patch", {
          ...patch(valid),
          expectedRevision: `sha256:${"0".repeat(64)}`,
        });
        assert.strictEqual(stale.reason, "conflict");

        // The inlet now produces metres, but net_flow sums metres per second.
        const broken = yield* ok(
          SystemsModelPatchResult,
          editor,
          "t3_systems_model_patch",
          patch([{ op: "replace", path: "/nodes/0/parameters/unit", value: "m" }]),
        );
        assert.strictEqual(broken.status, "rejected");
        const unit = broken.diagnostics.find((diagnostic) => diagnostic.code === "E-UNIT-001");
        assert.strictEqual(unit?.file, PUMP_SYSTEM);
        assert.isString(unit?.elementId);

        const dry = yield* ok(
          SystemsModelPatchResult,
          editor,
          "t3_systems_model_patch",
          patch(valid, { dryRun: true }),
        );
        assert.strictEqual(dry.status, "dry_run");
        assert.notStrictEqual(dry.revision, revision);

        const missing = yield* failure(
          editor,
          "t3_systems_model_patch",
          patch([{ op: "remove", path: "/nodes/99" }]),
        );
        assert.strictEqual(missing.reason, "invalid_patch");

        assert.strictEqual(yield* source(PUMP_SYSTEM), original);
      }).pipe(Effect.provide(tools({ [projectA]: rootA })));
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("patches a layout without changing the semantic digest", () =>
    Effect.gen(function* () {
      const { rootA, source } = yield* workspace;
      yield* Effect.gen(function* () {
        const before = yield* digestOf(editor);
        const patched = yield* ok(SystemsModelPatchResult, editor, "t3_systems_model_patch", {
          ...project,
          file: PUMP_LAYOUT,
          expectedRevision: yield* revisionOf(PUMP_LAYOUT),
          operations: [{ op: "replace", path: "/positions/inlet/x", value: 40 }],
        });
        assert.strictEqual(patched.status, "written");
        assert.isUndefined(patched.semanticDiff);
        assert.strictEqual(JSON.parse(yield* source(PUMP_LAYOUT)).positions.inlet.x, 40);
        assert.strictEqual(yield* digestOf(editor), before);
      }).pipe(Effect.provide(tools({ [projectA]: rootA })));
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("grants editing only where the caller may already write files", () =>
    Effect.gen(function* () {
      const { rootA, rootB, source } = yield* workspace;
      yield* Effect.gen(function* () {
        const original = yield* source(PUMP_SYSTEM);
        const patch = {
          ...project,
          file: PUMP_SYSTEM,
          expectedRevision: yield* revisionOf(PUMP_SYSTEM),
          operations: [{ op: "replace", path: "/nodes/0/parameters/value", value: 2 }],
        };
        const granted = Effect.fn(function* (scope: Scope) {
          const result = yield* ok(SystemsCapabilitiesResult, scope, "t3_systems_capabilities", {
            projectId: projectA,
          });
          return result.granted ?? ([] as ReadonlyArray<SystemsCapability>);
        });
        const readOnly = asClient("read-only");
        const fencedLink = asClient("auto-accept-edits", true);
        const deniedEdit: ReadonlyArray<[string, Scope]> = [
          ["read-only client", readOnly],
          ["plan thread", asThread("planner")],
          ["subagent of a plan thread", asThread("planner", true)],
          ["approval-required thread", asThread("supervised")],
          ["delegated child below a full-access parent", asThread("child")],
          ["thread in another project", asThread("elsewhere")],
          ["fenced linked environment", fencedLink],
        ];
        for (const [label, scope] of deniedEdit) {
          const denied = yield* failure(scope, "t3_systems_model_patch", patch);
          assert.strictEqual(denied.reason, "unauthorized", label);
          assert.strictEqual(denied.diagnostics?.[0]?.code, "E-AUTH-001", label);
          assert.notInclude(yield* granted(scope), "model.edit", label);
          // Anyone who reads may check a patch.
          const dry = yield* ok(SystemsModelPatchResult, scope, "t3_systems_model_patch", {
            ...patch,
            dryRun: true,
          });
          assert.strictEqual(dry.status, "dry_run", label);
        }
        assert.strictEqual(yield* source(PUMP_SYSTEM), original);

        // Read-only clients do not simulate; a fenced link and a plan thread may.
        const run = { ...project, experimentRef: PUMP_RUN, idempotencyKey: "access" };
        assert.strictEqual(
          (yield* failure(readOnly, "t3_systems_run_create", run)).code,
          "capability_denied",
        );
        assert.deepStrictEqual(yield* granted(readOnly), ["model.read"]);
        assert.deepStrictEqual(yield* granted(asThread("planner")), [
          "model.read",
          "simulation.execute",
        ]);
        yield* ok(SystemsRun, fencedLink, "t3_systems_run_create", run);

        for (const scope of [editor, asThread("full"), asClient("full-access", true)])
          assert.deepStrictEqual(yield* granted(scope), [
            "model.edit",
            "model.read",
            "simulation.execute",
          ]);
        assert.strictEqual(
          (yield* ok(SystemsModelPatchResult, asThread("full"), "t3_systems_model_patch", patch))
            .status,
          "written",
        );
      }).pipe(Effect.provide(tools({ [projectA]: rootA, [projectB]: rootB })));
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("AUTH-001: actuation is denied before any device adapter runs", () =>
    Effect.gen(function* () {
      const { rootA } = yield* workspace;
      let invoked = 0;
      const adapter: SystemsService.SystemsDeviceAdapter = (input) =>
        Effect.sync(() => {
          invoked++;
          return { operation: input.operation, target: input.target, status: "accepted" as const };
        });
      yield* Effect.gen(function* () {
        const systems = yield* SystemsService.SystemsService;
        const request = { projectId: projectA, operation: "actuate" as const, target: "pump" };
        // A read/simulate-only agent, and even a full-access one: agents hold no device capability.
        for (const scope of [asThread("planner"), asThread("full")]) {
          const authority = yield* systemsAuthority(projectA).pipe(
            Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
          );
          const denied = yield* Effect.flip(systems.requestDevice(request, authority));
          assert.strictEqual(denied.reason, "unauthorized");
          assert.strictEqual(denied.diagnostics?.[0]?.code, "E-AUTH-001");
        }
        assert.strictEqual(invoked, 0);
        // The capability is the only gate: holding it reaches the adapter.
        yield* systems.requestDevice(request, new Set(["device.actuate"]));
        assert.strictEqual(invoked, 1);
      }).pipe(Effect.provide(tools({ [projectA]: rootA }, { deviceAdapter: adapter })));
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );

  it.effect("reports that no device adapter is installed", () =>
    Effect.gen(function* () {
      const { rootA } = yield* workspace;
      yield* Effect.gen(function* () {
        const systems = yield* SystemsService.SystemsService;
        const missing = yield* Effect.flip(
          systems.requestDevice(
            { projectId: projectA, operation: "flash", target: "mcu" },
            new Set(["device.flash"]),
          ),
        );
        assert.strictEqual(missing.reason, "unavailable");
      }).pipe(Effect.provide(tools({ [projectA]: rootA })));
    }).pipe(Effect.scoped, Effect.provide(layer)),
  );
});
