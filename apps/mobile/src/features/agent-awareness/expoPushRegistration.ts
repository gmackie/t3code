import { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { SavedRemoteConnection } from "../../lib/connection";

export type ExpoPushConnection = Pick<
  SavedRemoteConnection,
  "environmentId" | "httpBaseUrl" | "bearerToken"
>;

const Registrations = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      environmentId: EnvironmentId,
      httpBaseUrl: Schema.String,
      bearerToken: Schema.NullOr(Schema.String),
    }),
  ),
);
const decodeRegistrations = Schema.decodeSync(Registrations);
const encodeRegistrations = Schema.encodeSync(Registrations);

/** Keeps registration independent of the foreground socket and retries failed removals. */
export function createExpoPushRegistration(
  register: (connection: ExpoPushConnection, token: string | null) => Promise<void>,
  storage?: {
    readonly read: () => Promise<string | null>;
    readonly write: (value: string) => Promise<void>;
  },
) {
  let previous: readonly ExpoPushConnection[] | undefined;
  return async (saved: Readonly<Record<string, ExpoPushConnection>>, token: string | null) => {
    if (previous === undefined) {
      const savedState = await storage?.read();
      previous = savedState ? decodeRegistrations(savedState) : [];
    }
    const known = previous;
    const connections = Object.values(saved).flatMap((connection) => {
      const usable = connection.bearerToken
        ? connection
        : known.find((old) => old.environmentId === connection.environmentId);
      if (token === null && !known.some((old) => old.environmentId === connection.environmentId))
        return [];
      return usable ? [usable] : [];
    });
    const removed = known.filter((old) => !(old.environmentId in saved));
    // Save the intent first so an app restart cannot forget a registered device
    // or an offline environment that still needs to be unregistered.
    if (storage) await storage.write(encodeRegistrations([...connections, ...removed]));
    const results = await Promise.allSettled(
      connections.map((connection) => register(connection, token)),
    );
    const removals = await Promise.allSettled(
      removed.map((connection) => register(connection, null)),
    );
    previous = [
      ...connections.filter((_, index) => token !== null || results[index]?.status === "rejected"),
      ...removed.filter((_, index) => removals[index]?.status === "rejected"),
    ];
    if (storage) await storage.write(encodeRegistrations(previous));
    return {
      registered: token ? results.filter((result) => result.status === "fulfilled").length : 0,
      failed: [...results, ...removals].filter((result) => result.status === "rejected").length,
    };
  };
}
