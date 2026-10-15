import { describe, expect, it } from "vite-plus/test";
import { diffFingerprints } from "./FirmwareDiff.ts";

const fn = (name: string, address: string, shape: string, bytes = `${shape}:${address}`) => ({
  name,
  address,
  instructions: 4,
  shape,
  bytes,
});

describe("firmware diff", () => {
  it("pairs named functions and tells relocation from real changes", () => {
    const result = diffFingerprints(
      [fn("main", "0x100", "a", "x"), fn("parse", "0x200", "b"), fn("crc", "0x300", "c")],
      [fn("main", "0x100", "a", "x"), fn("parse", "0x240", "b"), fn("crc", "0x300", "c2")],
      false,
    );
    expect(result).toMatchObject({ identical: 1, relocated: 1, changed: 1, added: 0, removed: 0 });
    expect(result.functions.map((row) => [row.status, row.left?.name])).toEqual([
      ["relocated", "parse"],
      ["changed", "crc"],
    ]);
  });

  it("matches Ghidra-named functions by unique shape and leaves ambiguous ones unpaired", () => {
    const result = diffFingerprints(
      [
        fn("FUN_00001000", "0x1000", "s1"),
        fn("FUN_00002000", "0x2000", "dup"),
        fn("FUN_00003000", "0x3000", "dup"),
      ],
      [
        fn("FUN_00001400", "0x1400", "s1"),
        fn("FUN_00002400", "0x2400", "dup"),
        fn("FUN_00005000", "0x5000", "new"),
      ],
      false,
    );
    expect(result).toMatchObject({ relocated: 1, added: 2, removed: 2 });
    expect(result.functions[0]).toEqual({
      status: "relocated",
      left: { name: "FUN_00001000", address: "0x1000" },
      right: { name: "FUN_00001400", address: "0x1400" },
    });
  });
});
