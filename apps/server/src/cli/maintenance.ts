import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";

import { applyActivityRetention, inspectActivityRetention } from "../stateMaintenance.ts";

class StateMaintenanceCommandError extends Schema.TaggedErrorClass<StateMaintenanceCommandError>()(
  "StateMaintenanceCommandError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return this.cause instanceof Error ? this.cause.message : String(this.cause);
  }
}

const compactActivitiesCommand = Command.make("compact-activities", {
  databasePath: Flag.string("database-path").pipe(
    Flag.withDescription("Path to the offline T3 state.sqlite database."),
  ),
  retainPerThread: Flag.integer("retain-per-thread").pipe(
    Flag.withDescription("Number of newest activity rows to retain per thread."),
    Flag.withDefault(500),
  ),
  apply: Flag.boolean("apply").pipe(
    Flag.withDescription("Create a full backup, delete candidates, and vacuum the database."),
    Flag.withDefault(false),
  ),
  backupPath: Flag.string("backup-path").pipe(
    Flag.withDescription("Optional non-existing path for the pre-change SQLite backup."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Inspect activity projection retention candidates. Without --apply this command is read-only.",
  ),
  Command.withHandler(({ apply, backupPath, databasePath, retainPerThread }) =>
    (apply
      ? Effect.tryPromise({
          try: () =>
            applyActivityRetention({
              databasePath,
              retainPerThread,
              ...(Option.isSome(backupPath) ? { backupPath: backupPath.value } : {}),
            }),
          catch: (cause) => new StateMaintenanceCommandError({ cause }),
        })
      : Effect.try({
          try: () => inspectActivityRetention({ databasePath, retainPerThread }),
          catch: (cause) => new StateMaintenanceCommandError({ cause }),
        })
    ).pipe(
      Effect.flatMap((result) => Console.log(JSON.stringify(result, null, 2))),
      Effect.asVoid,
    ),
  ),
);

export const maintenanceCommand = Command.make("maintenance").pipe(
  Command.withDescription("Inspect or compact offline T3 state."),
  Command.withSubcommands([compactActivitiesCommand]),
);
