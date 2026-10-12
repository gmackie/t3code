import { expectTypeOf, it } from "vite-plus/test";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as RpcMiddleware from "effect/rpc/RpcMiddleware";
class Database extends Context.Service<Database, { readonly value: string }>()(
  "t3/rpcHandlerRequirements.test/Database",
) {}
class Principal extends Context.Service<Principal, { readonly name: string }>()(
  "t3/rpcHandlerRequirements.test/Principal",
) {}
class Authentication extends RpcMiddleware.Service<Authentication, { provides: Principal }>()(
  "test/Authentication",
) {}

it("preserves unary and streaming requirements while excluding middleware-provided services", () => {
  const group = RpcGroup.make(
    Rpc.make("read", { success: Schema.String }).middleware(Authentication),
    Rpc.make("watch", { success: Schema.String, stream: true }),
  );
  const handlers = group.toLayer({
    read: () => Effect.map(Principal, (principal) => principal.name),
    watch: () => Stream.fromEffect(Effect.map(Database, (database) => database.value)),
  });
  expectTypeOf<Layer.Services<typeof handlers>>().toEqualTypeOf<Database>();
});

it("retains services used by unary handlers", () => {
  const group = RpcGroup.make(Rpc.make("read", { success: Schema.String }));
  const handlers = group.toLayer({
    read: () => Effect.map(Database, (database) => database.value),
  });
  expectTypeOf<Layer.Services<typeof handlers>>().toEqualTypeOf<Database>();
});
