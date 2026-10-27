import type { BlockCatalogDocument } from "@t3tools/systems-model/documents";

/**
 * Dimensional units resolved against the locked catalogs (RFC-001 §4.3). Two units are
 * interchangeable only when their SI dimensions and scale agree; a symbol the catalog
 * does not define compares by symbol alone.
 */
export interface Unit {
  readonly symbol: string;
  readonly dims: ReadonlyArray<number> | undefined;
  readonly scale: number;
}

export type UnitTable = BlockCatalogDocument["units"];

const parseScale = (scale: string) => {
  const [num, den = "1"] = scale.split("/");
  return Number(num) / Number(den);
};

export const DIMENSIONLESS = "1";

export const unitOf = (units: UnitTable, symbol: string): Unit => {
  const entry = units[symbol];
  return entry === undefined
    ? { symbol, dims: undefined, scale: Number.NaN }
    : { symbol, dims: entry.dims, scale: parseScale(entry.scale) };
};

export const isKnown = (units: UnitTable, symbol: string) => units[symbol] !== undefined;

const sameDims = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) =>
  a.every((dim, index) => dim === b[index]);

const sameScale = (a: number, b: number) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a));

export const sameUnit = (a: Unit, b: Unit) =>
  a.dims === undefined || b.dims === undefined
    ? a.symbol === b.symbol
    : sameDims(a.dims, b.dims) && sameScale(a.scale, b.scale);

/** Same dimension at a different scale: an explicit `std.unit_convert@1` can bridge it. */
export const convertible = (a: Unit, b: Unit) =>
  a.dims !== undefined && b.dims !== undefined && sameDims(a.dims, b.dims);

/** Product (`power` 1) or quotient (`power` -1), named by the catalog when it has a match. */
export const combine = (units: UnitTable, a: Unit, b: Unit, power: 1 | -1): Unit => {
  const symbol = power === 1 ? `${a.symbol}*${b.symbol}` : `${a.symbol}/(${b.symbol})`;
  if (a.dims === undefined || b.dims === undefined)
    return { symbol, dims: undefined, scale: Number.NaN };
  const bDims = b.dims;
  const dims = a.dims.map((dim, index) => dim + power * bDims[index]!);
  const scale = power === 1 ? a.scale * b.scale : a.scale / b.scale;
  const named = Object.keys(units)
    .toSorted()
    .map((candidate) => unitOf(units, candidate))
    .find((candidate) => sameDims(candidate.dims!, dims) && sameScale(candidate.scale, scale));
  return named ?? { symbol, dims, scale };
};
