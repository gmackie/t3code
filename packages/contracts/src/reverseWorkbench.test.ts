import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { ReverseWorkbenchRequest, reverseOperationMutates } from "./reverseWorkbench.ts";
const decode = Schema.decodeUnknownSync(ReverseWorkbenchRequest, { onExcessProperty: "error" });
const scope = { projectId: "p", investigationId: "i" };
describe("reverse operation boundary", () => {
  it("has no raw shell or debugger command escape hatch", () => {
    expect(() => decode({ ...scope, operation: "shell", command: "id" })).toThrow();
    expect(() =>
      decode({ ...scope, operation: "lab", action: "command", command: "shell" }),
    ).toThrow();
    expect(() =>
      decode({ ...scope, operation: "scan", engine: "gadgets", executable: "/tmp/tool" }),
    ).toThrow();
  });
  it("rejects unsafe offsets and input sizes", () => {
    expect(() =>
      decode({ ...scope, operation: "bytes", offset: Number.MAX_SAFE_INTEGER + 1, length: 1 }),
    ).toThrow();
    expect(() => decode({ ...scope, operation: "bytes", offset: 0, length: 4097 })).toThrow();
    expect(() =>
      decode({ ...scope, operation: "lab", action: "command", dataHex: "zz" }),
    ).toThrow();
  });
  it("does not classify execution or physical control as passive reading", () => {
    expect(reverseOperationMutates(decode({ ...scope, operation: "status" }))).toBe(false);
    expect(
      reverseOperationMutates(decode({ ...scope, operation: "analysis", action: "open" })),
    ).toBe(true);
    expect(
      reverseOperationMutates(
        decode({
          ...scope,
          operation: "emulator",
          action: "start",
          profile: "cortex-m3-lm3s6965evb",
        }),
      ),
    ).toBe(true);
    expect(reverseOperationMutates(decode({ ...scope, operation: "lab", action: "arm" }))).toBe(
      true,
    );
  });
});
