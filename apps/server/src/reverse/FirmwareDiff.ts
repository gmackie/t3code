import type { ReverseDiffResult } from "@t3tools/contracts";
import type { GhidraFingerprint } from "./GhidraSession.ts";

const MAX_ROWS = 2000;
const ORDER = { changed: 0, removed: 1, added: 2, relocated: 3 } as const;
// Ghidra names functions it could not name after their address; those say nothing across builds.
const meaningful = (name: string) => !/^(?:FUN|thunk_FUN|LAB|SUB)_[0-9a-f]+$/i.test(name);

/**
 * Pairs functions by meaningful name first, then by unique instruction shape, so a function that
 * moved or lost its symbol still matches. Unchanged pairs are counted, not listed.
 */
export function diffFingerprints(
  left: ReadonlyArray<GhidraFingerprint>,
  right: ReadonlyArray<GhidraFingerprint>,
  truncated: boolean,
): ReverseDiffResult {
  const result = { identical: 0, relocated: 0, changed: 0, added: 0, removed: 0 };
  const rows: Array<ReverseDiffResult["functions"][number]> = [];
  const side = (fn: GhidraFingerprint) => ({ name: fn.name, address: fn.address });
  const compare = (a: GhidraFingerprint, b: GhidraFingerprint) => {
    if (a.bytes === b.bytes && a.address === b.address) result.identical++;
    else if (a.shape === b.shape) {
      result.relocated++;
      rows.push({ status: "relocated", left: side(a), right: side(b) });
    } else {
      result.changed++;
      rows.push({ status: "changed", left: side(a), right: side(b) });
    }
  };

  const unmatchedRight = new Set(right);
  const rightByName = new Map(right.filter((fn) => meaningful(fn.name)).map((fn) => [fn.name, fn]));
  const leftovers: GhidraFingerprint[] = [];
  for (const fn of left) {
    const twin = meaningful(fn.name) ? rightByName.get(fn.name) : undefined;
    if (twin && unmatchedRight.has(twin)) {
      unmatchedRight.delete(twin);
      compare(fn, twin);
    } else leftovers.push(fn);
  }

  // Shapes that occur once on each side are safe to pair; repeated shapes are ambiguous.
  const unique = (fns: Iterable<GhidraFingerprint>) => {
    const byShape = new Map<string, GhidraFingerprint | null>();
    for (const fn of fns) byShape.set(fn.shape, byShape.has(fn.shape) ? null : fn);
    return byShape;
  };
  const rightByShape = unique(unmatchedRight);
  const leftByShape = unique(leftovers);
  for (const fn of leftovers) {
    const twin = leftByShape.get(fn.shape) ? rightByShape.get(fn.shape) : undefined;
    if (twin) {
      unmatchedRight.delete(twin);
      compare(fn, twin);
    } else {
      result.removed++;
      rows.push({ status: "removed", left: side(fn) });
    }
  }
  for (const fn of unmatchedRight) {
    result.added++;
    rows.push({ status: "added", right: side(fn) });
  }
  // Real differences first: a shifted build can relocate thousands of functions.
  rows.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  return {
    ...result,
    truncated: truncated || rows.length > MAX_ROWS,
    functions: rows.slice(0, MAX_ROWS),
  };
}
