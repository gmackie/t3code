import * as Effect from "effect/Effect";

import externalThreadImports from "./041_ExternalThreadImports.ts";
import externalThreadImportEnvironments from "./042_ExternalThreadImportEnvironments.ts";
import repairCustomLocalMigrationSchema from "./043_RepairCustomLocalMigrationSchema.ts";
import repairCustomLocalProjectionIndexes from "./044_RepairCustomLocalProjectionIndexes.ts";

/**
 * Replays the idempotent custom-local schema work after upstream claimed
 * migration ids 41-44 for Orchestrator V2. Existing custom-local databases
 * may already contain any subset of these changes, while fresh databases
 * need all of them.
 */
export default Effect.gen(function* () {
  yield* externalThreadImports;
  yield* externalThreadImportEnvironments;
  yield* repairCustomLocalMigrationSchema;
  yield* repairCustomLocalProjectionIndexes;
});
