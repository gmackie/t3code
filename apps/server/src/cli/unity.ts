import { UnityCommandRequest, UnityHookRequest } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { Argument, Command } from "effect/cli";
import * as UnityHooks from "../game/UnityHooks.ts";
import * as ProcessRunner from "../processRunner.ts";

const decodeRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(UnityHookRequest));

export const unityCommand = Command.make("unity-hooks", {
  request: Argument.String("request-json"),
}).pipe(
  Command.withDescription(
    "Invoke Unity gameplay hooks using the same typed service as the unity_hooks MCP tool. Pass a UnityHookRequest JSON object with an explicit Editor project path or Player port file.",
  ),
  Command.withHandler(({ request }) =>
    Effect.gen(function* () {
      const hooks = yield* UnityHooks.UnityHooks;
      const result = yield* hooks.execute(yield* decodeRequest(request));
      yield* Console.log(JSON.stringify(result));
    }).pipe(Effect.provide(UnityHooks.layer.pipe(Layer.provide(ProcessRunner.layer)))),
  ),
);

const decodeCommand = Schema.decodeUnknownEffect(Schema.fromJsonString(UnityCommandRequest));
export const unityJobsCommand = Command.make("unity-command", {
  request: Argument.String("request-json"),
}).pipe(
  Command.withDescription(
    "Discover Unity commands, submit detached jobs, inspect status and request cancellation through the unity_command service.",
  ),
  Command.withHandler(({ request }) =>
    Effect.gen(function* () {
      const unity = yield* UnityHooks.UnityHooks;
      yield* Console.log(JSON.stringify(yield* unity.command(yield* decodeCommand(request))));
    }).pipe(Effect.provide(UnityHooks.layer.pipe(Layer.provide(ProcessRunner.layer)))),
  ),
);
