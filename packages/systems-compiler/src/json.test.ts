import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { readPackFiles } from "@t3tools/systems-model/pack";

import { canonicalize, parseStrictJson } from "./json.ts";

const canonicalText = (text: string) => {
  const parsed = parseStrictJson(text);
  assert.deepStrictEqual(parsed.diagnostics, []);
  return canonicalize(parsed.value);
};

const failures = (input: string | Uint8Array) =>
  parseStrictJson(input, "model.json").diagnostics.map((diagnostic) => [
    diagnostic.code,
    diagnostic.pointer,
  ]);

describe("canonicalize (RFC 8785)", () => {
  it("serializes the RFC's worked example byte for byte", () => {
    const source = String.raw`{
      "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
      "string": "\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/",
      "literals": [null, true, false]
    }`;
    assert.strictEqual(
      canonicalText(source),
      String.raw`{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\\\"/"}`,
    );
  });

  it("sorts members by UTF-16 code units, recursively", () => {
    const source = String.raw`{"\u20ac":1,"\r":2,"\ufb33":3,"1":4,"\ud83d\ude00":5,"\u0080":6,"\u00f6":{"b":0,"a":0}}`;
    assert.strictEqual(
      canonicalText(source),
      '{"\\r":2,"1":4,"\u0080":6,"ö":{"a":0,"b":0},"€":1,"😀":5,"\ufb33":3}',
    );
  });

  it("formats numbers as ECMAScript does", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["1.0", "1"],
      ["-0", "0"],
      ["-0.0", "0"],
      ["1E3", "1000"],
      ["1e21", "1e+21"],
      ["1e20", "100000000000000000000"],
      ["0.000001", "0.000001"],
      ["1e-7", "1e-7"],
      ["5e-324", "5e-324"],
      ["1.7976931348623157e308", "1.7976931348623157e+308"],
      ["9007199254740993", "9007199254740992"],
      ["-1.5E-2", "-0.015"],
    ];
    for (const [source, expected] of cases)
      assert.strictEqual(canonicalText(source), expected, source);
  });

  it("escapes only quote, backslash and control characters", () => {
    assert.strictEqual(
      canonicalize('a\u0000\u001f\b\t\n\f\r"\\/é'),
      String.raw`"a\u0000\u001f\b\t\n\f\r\"\\/é"`,
    );
  });

  it("refuses values JCS cannot represent", () => {
    assert.throws(() => canonicalize(Number.NaN));
    assert.throws(() => canonicalize({ x: Number.POSITIVE_INFINITY }));
    assert.throws(() => canonicalize("\ud800"));
    assert.throws(() => canonicalize(1n));
  });
});

describe("parseStrictJson", () => {
  it("reports every duplicate key with its pointer", () => {
    assert.deepStrictEqual(
      failures('{"nodes":[{"id":"a","type":"x","id":"b"}],"a/b":{"~":1,"~":2}}'),
      [
        ["E-SCHEMA-001", "/nodes/0/id"],
        ["E-SCHEMA-001", "/a~1b/~0"],
      ],
    );
  });

  it("rejects NaN, Infinity and numbers outside float64", () => {
    assert.deepStrictEqual(failures('{"gain":NaN}'), [["E-SCHEMA-001", "/gain"]]);
    assert.deepStrictEqual(failures('{"gain":-Infinity}'), [["E-SCHEMA-001", "/gain"]]);
    assert.deepStrictEqual(failures('{"gain":[1e400]}'), [["E-SCHEMA-001", "/gain/0"]]);
  });

  it("rejects invalid UTF-8 and lone surrogates", () => {
    assert.deepStrictEqual(failures(new Uint8Array([0x7b, 0xff, 0x7d])), [["E-SCHEMA-001", ""]]);
    assert.deepStrictEqual(failures(String.raw`{"title":"\ud800x"}`), [["E-SCHEMA-001", "/title"]]);
  });

  it("rejects what JSON.parse rejects, and trailing content", () => {
    for (const source of ["{'a':1}", '{"a":1,}', "[01]", '"\t"', "{} {}", ""])
      assert.strictEqual(failures(source).length, 1, source);
  });

  it("keeps a __proto__ key as data", () => {
    const parsed = parseStrictJson('{"__proto__":{"polluted":true}}');
    assert.deepStrictEqual(Object.keys(parsed.value as object), ["__proto__"]);
    assert.isUndefined(({} as Record<string, unknown>).polluted);
  });

  it.effect("accepts every conformance fixture exactly as JSON.parse reads it", () =>
    Effect.gen(function* () {
      const root = yield* (yield* Path.Path).fromFileUrl(
        new URL("../../systems-model/fixtures/conformance-v0.1/", import.meta.url),
      );
      const { files } = yield* readPackFiles(root);
      for (const [file, bytes] of files) {
        if (!file.endsWith(".json")) continue;
        const parsed = parseStrictJson(bytes, file);
        assert.deepStrictEqual(parsed.diagnostics, [], file);
        assert.deepStrictEqual(parsed.value, JSON.parse(new TextDecoder().decode(bytes)), file);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
