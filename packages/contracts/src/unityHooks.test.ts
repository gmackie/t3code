import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { UnityHookRequest, UnityHookCatalog } from "./unityHooks";
const decode = Schema.decodeUnknownSync(UnityHookRequest);
const decodeCatalog = Schema.decodeUnknownSync(UnityHookCatalog);
it("accepts bounded vector writes and rejects malformed vector values", () => {
  const request = {
    action: "write",
    target: { kind: "editor", projectPath: "/fixture" },
    generation: "g",
    handle: "h",
    value: [1, 2, 3],
    expected: [0, 0, 0],
  };
  expect(decode(request).action).toBe("write");
  for (const value of [[1], [1, 2, 3, 4, 5], [1, Infinity], [1, "two"]])
    expect(() => decode({ ...request, value })).toThrow();
});
it("retains enum choices and vector dimensions in discovery", () => {
  const base = {
    key: "mode",
    handle: "mode",
    description: "Mode",
    unit: null,
    writable: true,
    minimum: null,
    maximum: null,
  };
  const result = decodeCatalog({
    schema: "gmacko.agent-hooks/v1",
    generation: "g",
    target: "player",
    hooks: [
      { ...base, type: "enum", choices: ["Walk", "Run"] },
      { ...base, key: "position", handle: "position", type: "vector", components: 3 },
    ],
  });
  expect(result.hooks[0]?.choices).toEqual(["Walk", "Run"]);
  expect(result.hooks[1]?.components).toBe(3);
});
