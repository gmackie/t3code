export function sortCopy<T>(
  values: ReadonlyArray<T>,
  compare: (left: T, right: T) => number,
): ReadonlyArray<T> {
  const copy = [...values];
  // eslint-disable-next-line unicorn/no-array-sort -- Hermes lacks Array#toSorted in current simulator runtime.
  return copy.sort(compare);
}

export function findLastCompat<T>(
  values: ReadonlyArray<T>,
  predicate: (value: T) => boolean,
): T | undefined {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (value !== undefined && predicate(value)) {
      return value;
    }
  }

  return undefined;
}
