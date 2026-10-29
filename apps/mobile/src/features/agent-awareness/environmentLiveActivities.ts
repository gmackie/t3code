import {
  EnvironmentId,
  type LiveActivityRegistration,
  type LiveActivitySnapshot,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { AgentActivityProps } from "../../widgets/AgentActivity";
import type { ExpoPushConnection } from "./expoPushRegistration";

export interface NativeActivity {
  getId(): string;
  getPushToken(): Promise<string | null>;
  addPushTokenListener(listener: () => void): { remove(): void };
  update(props: AgentActivityProps, staleDate?: Date): Promise<void>;
  end(policy?: "immediate" | "default", props?: AgentActivityProps): Promise<void>;
}

const Records = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      connection: Schema.Struct({
        environmentId: EnvironmentId,
        httpBaseUrl: Schema.String,
        bearerToken: Schema.NullOr(Schema.String),
      }),
      activityId: Schema.String,
    }),
  ),
);

const decodeRecords = Schema.decodeSync(Records);
const encodeRecords = Schema.encodeSync(Records);

/** Owns one native card per environment; network failures retain cleanup intent across launches. */
export function createEnvironmentLiveActivitySync(input: {
  readonly snapshot: (connection: ExpoPushConnection) => Promise<LiveActivitySnapshot>;
  readonly register: (
    connection: ExpoPushConnection,
    registration: LiveActivityRegistration,
  ) => Promise<void>;
  readonly list: () => NativeActivity[];
  readonly start: (props: AgentActivityProps, staleDate: Date) => NativeActivity | null;
  readonly read: () => Promise<string | null>;
  readonly write: (value: string) => Promise<void>;
  readonly onToken: () => void;
  readonly canStart: () => boolean;
}) {
  let records: Array<{ connection: ExpoPushConnection; activityId: string }> | undefined;
  const subscriptions = new Map<string, { remove(): void }>();
  const registered = new Map<string, string>();
  let generation = 0;
  const persist = async () => input.write(encodeRecords(records ?? []));
  const synchronize = async (
    saved: Readonly<Record<string, ExpoPushConnection>>,
    enabled: boolean,
    isCurrent: () => boolean = () => true,
  ) => {
    const currentGeneration = ++generation;
    const current = () => currentGeneration === generation && isCurrent();
    if (!records) {
      const stored = await input.read();
      records = stored ? [...decodeRecords(stored)] : [];
    }
    let failed = 0;
    let unavailable = 0;
    const pendingRemoval = new Set<string>();
    const instances = new Map(input.list().map((activity) => [activity.getId(), activity]));
    for (const [id, activity] of instances) {
      if (!records.some((record) => record.activityId === id)) await activity.end("immediate");
    }
    const forget = async (
      record: { connection: ExpoPushConnection; activityId: string },
      immediate: boolean,
      props?: AgentActivityProps,
    ) => {
      const activity = instances.get(record.activityId);
      if (activity) await activity.end(immediate ? "immediate" : "default", props);
      subscriptions.get(record.activityId)?.remove();
      subscriptions.delete(record.activityId);
      registered.delete(record.activityId);
      try {
        await input.register(record.connection, { activityId: null, token: null });
        records = records!.filter((candidate) => candidate !== record);
        await persist();
      } catch {
        failed++;
        pendingRemoval.add(record.connection.environmentId);
      }
    };
    for (const record of records) {
      if (!enabled || !saved[record.connection.environmentId] || !instances.has(record.activityId))
        await forget(record, true);
    }
    if (!enabled || !current()) return { active: 0, failed, unavailable };
    let active = 0;
    for (const connection of Object.values(saved)) {
      if (!connection.bearerToken || !current() || pendingRemoval.has(connection.environmentId))
        continue;
      let record = records.find(
        (value) => value.connection.environmentId === connection.environmentId,
      );
      try {
        const snapshot = await input.snapshot(connection);
        if (!current()) break;
        if (!snapshot.configured || !snapshot.aggregate || snapshot.aggregate.activeCount === 0) {
          if (!snapshot.configured) unavailable++;
          if (record) await forget(record, !snapshot.configured, snapshot.aggregate ?? undefined);
          continue;
        }
        const staleDate = new Date(Date.now() + 10 * 60_000);
        let activity = record ? instances.get(record.activityId) : undefined;
        if (!activity) {
          if (!input.canStart()) continue;
          activity = input.start(snapshot.aggregate, staleDate) ?? undefined;
          if (!activity) {
            unavailable++;
            continue;
          }
          record = { connection, activityId: activity.getId() };
          records.push(record);
          instances.set(record.activityId, activity);
          await persist();
        } else {
          await activity.update(snapshot.aggregate, staleDate);
          record!.connection = connection;
          await persist();
        }
        if (!subscriptions.has(activity.getId()))
          subscriptions.set(activity.getId(), activity.addPushTokenListener(input.onToken));
        const token = await activity.getPushToken();
        if (!current()) break;
        if (token) {
          const signature = `${connection.httpBaseUrl}:${connection.bearerToken}:${token}`;
          if (registered.get(activity.getId()) !== signature) {
            try {
              await input.register(connection, { activityId: activity.getId(), token });
            } catch (error) {
              // Without an accepted update token a local card would stay stale.
              await forget(record!, true);
              throw error;
            }
            registered.set(activity.getId(), signature);
          }
          active++;
        }
      } catch {
        failed++;
      }
    }
    return { active, failed, unavailable };
  };
  return {
    synchronize,
    dispose: () => {
      generation++;
      for (const subscription of subscriptions.values()) subscription.remove();
      subscriptions.clear();
    },
  };
}
