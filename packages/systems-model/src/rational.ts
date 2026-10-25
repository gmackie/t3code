import * as Schema from "effect/Schema";

/**
 * Exact rational seconds (RFC-001 §3.2). Integer strings, because clock arithmetic
 * can exceed JavaScript's exact integer range; canonical form is checked by the
 * validator so a non-reduced value is a typed `E-TIME-001`, not a parse failure.
 */
export const RationalTime = Schema.Struct({
  num: Schema.String.check(Schema.isPattern(/^-?(0|[1-9][0-9]*)$/)),
  den: Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/)),
});
export type RationalTime = typeof RationalTime.Type;

export interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

export const toRational = (value: RationalTime): Rational => ({
  num: BigInt(value.num),
  den: BigInt(value.den),
});

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

/** True when the denominator is positive and the fraction is fully reduced. */
export const isCanonical = (value: RationalTime): boolean => {
  const { num, den } = toRational(value);
  return den > 0n && gcd(num, den) === 1n;
};

export const compare = (a: RationalTime, b: RationalTime): -1 | 0 | 1 => {
  const x = toRational(a);
  const y = toRational(b);
  const left = x.num * y.den;
  const right = y.num * x.den;
  return left < right ? -1 : left > right ? 1 : 0;
};

export const sign = (value: RationalTime): -1 | 0 | 1 => {
  const num = BigInt(value.num);
  return num < 0n ? -1 : num > 0n ? 1 : 0;
};
