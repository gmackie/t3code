import { assert, describe, it } from "@effect/vitest";

import { add, ceil, compare, divide, make, multiply, subtract } from "./rational.ts";

const r = (num: number, den = 1) => make(BigInt(num), BigInt(den));

describe("rational time", () => {
  it("stays exact where float64 would drift", () => {
    let t = r(0);
    for (let tick = 0; tick < 10; tick++) t = add(t, r(1, 10));
    assert.deepStrictEqual(t, r(1));
    assert.notStrictEqual(
      Array.from({ length: 10 }).reduce<number>((sum) => sum + 0.1, 0),
      1,
    );
  });

  it("keeps values reduced with a positive denominator", () => {
    assert.deepStrictEqual(make(6n, -4n), { num: "-3", den: "2" });
    assert.deepStrictEqual(subtract(r(5, 2), r(1)), r(3, 2));
    assert.deepStrictEqual(multiply(r(3, 2), 4n), r(6));
    assert.deepStrictEqual(divide(r(5, 2), r(1, 2)), r(5));
  });

  it("compares integers past Number.MAX_SAFE_INTEGER", () => {
    const big = { num: "9007199254740993", den: "1" };
    assert.strictEqual(compare(big, { num: "9007199254740992", den: "1" }), 1);
  });

  it("rounds up toward the next tick index", () => {
    assert.strictEqual(ceil(r(3, 2)), 2n);
    assert.strictEqual(ceil(r(-3, 2)), -1n);
    assert.strictEqual(ceil(r(2)), 2n);
  });
});
