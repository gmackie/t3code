# Plugin migration boundary

The Bob planning work in this checkout is the compatibility source for two standalone
plugins. It is intentionally not a second copy of the T3 implementation: the plugin
repositories own provider clients, credentials, SQLite/state, dispatch, and UI, while
T3 owns lifecycle, capability grants, generic work-item contracts, and native hosts.

## Repositories

- Bob: `/Volumes/dev/t3code/t3code-bob-plugin`
- Linear: `/Volumes/dev/t3code/t3code-linear-plugin`

The exact source branches and file classifications are recorded in
[`docs/plugins/migration-manifest.yaml`](../plugins/migration-manifest.yaml).

## Compatibility rule

Existing Bob and Linear routes may remain available while the plugin-backed paths reach
parity. They must be behind an explicit compatibility boundary and must not become a
new permanent provider dependency. Disabling Linear must not disable Bob; disabling Bob
must leave Linear data intact.

## Ownership rule

Bob persists Bob-to-Linear mappings and Bob-to-T3 thread/run links. T3 only stores the
plugin lifecycle state and opaque external references needed for navigation. Never
migrate Bob-owned SQLite tables into T3's database.
