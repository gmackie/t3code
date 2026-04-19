export function createStageDependencyOverrides(input: {
  readonly catalog: Record<string, unknown>;
  readonly platformNodeSharedVersion: string;
}): Record<string, string> {
  const readCatalogVersion = (key: string): string => {
    const value = input.catalog[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`Missing catalog version for '${key}'.`);
    }
    return value;
  };

  return {
    effect: readCatalogVersion("effect"),
    "@effect/platform-bun": readCatalogVersion("@effect/platform-bun"),
    "@effect/platform-node": readCatalogVersion("@effect/platform-node"),
    "@effect/platform-node-shared": input.platformNodeSharedVersion,
    "@effect/sql-sqlite-bun": readCatalogVersion("@effect/sql-sqlite-bun"),
  };
}
