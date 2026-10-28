import { bobOperationSchemas } from "@t3tools/contracts/bobContract";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  planBelongsToProject,
  type GetPlanOutput,
  type GetItemOutput,
  type ListPlansOutput,
  type BobOperationInput,
  type GetCapabilitiesOutput,
} from "@t3tools/contracts/bobCoordination";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { useCallback, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { AppBar } from "../../components/ui/AppBar";
import { bobCoordination } from "../../state/bobCoordination";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";
import { useOpenLinkedThread } from "../threads/useOpenLinkedThread";

type Props = StaticScreenProps<{ environmentId: EnvironmentId; threadId: ThreadId }>;
const outputDecoders = new Map(
  Array.from(bobOperationSchemas, ([operation, schemas]) => [
    operation,
    Schema.decodeUnknownSync(schemas.output),
  ]),
);
const decode = <A,>(operation: string, value: unknown): A =>
  outputDecoders.get(operation)!(value) as A;
type BobRequest = (input: BobOperationInput) => Promise<unknown>;
type ProjectBinding = Parameters<typeof planBelongsToProject>[1];

function failureMessage(result: AsyncResult.Failure<unknown, unknown>, fallback: string): string {
  const cause = Cause.squash(result.cause);
  return cause instanceof Error ? cause.message : fallback;
}

/** Capabilities, this project's plans and, when asked for, one plan with its items. */
async function loadWork(
  request: BobRequest,
  binding: ProjectBinding | null | undefined,
  planId?: string,
  afterPlanId?: string,
) {
  const caps = decode<GetCapabilitiesOutput>(
    "GetCapabilities",
    await request({ operation: "GetCapabilities", input: { contractVersion: "1" } }),
  );
  const page = decode<ListPlansOutput>(
    "ListPlans",
    await request({
      operation: "ListPlans",
      input: { contractVersion: "1", limit: 50, ...(afterPlanId ? { afterPlanId } : {}) },
    }),
  );
  const snapshots = await Promise.all(
    page.plans.map(async (entry) => ({
      entry,
      snapshot: decode<GetPlanOutput>(
        "GetPlan",
        await request({
          operation: "GetPlan",
          input: { contractVersion: "1", resourceId: entry.planId },
        }),
      ),
    })),
  );
  const visible = snapshots
    .filter(({ snapshot }) => binding && planBelongsToProject(snapshot.definition, binding))
    .map(({ entry }) => entry);
  const detail = planId
    ? decode<GetPlanOutput>(
        "GetPlan",
        await request({
          operation: "GetPlan",
          input: { contractVersion: "1", resourceId: planId },
        }),
      )
    : null;
  if (detail && (!binding || !planBelongsToProject(detail.definition, binding)))
    throw new Error("Plan belongs to another project.");
  const children = detail
    ? await Promise.all(
        detail.items.map((item) =>
          request({
            operation: "GetItem",
            input: { contractVersion: "1", resourceId: item.itemId },
          }).then((value) => decode<GetItemOutput>("GetItem", value).item),
        ),
      )
    : [];
  return { caps, visible, nextPlanId: page.nextPlanId ?? null, detail, children };
}

const useBobConnection = (environmentId: EnvironmentId) =>
  useEnvironmentQuery(bobCoordination.connection({ environmentId, input: {} }));

export function WorkRouteScreen(props: Props) {
  const { environmentId, threadId } = props.route.params;
  const connection = useBobConnection(environmentId);
  // A new thread or connection state starts from an empty view.
  return (
    <WorkScreen
      key={`${environmentId}:${threadId}:${connection.data?.configured === true}`}
      environmentId={environmentId}
      threadId={threadId}
      connection={connection}
    />
  );
}

function WorkScreen({
  environmentId,
  threadId,
  connection,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  connection: ReturnType<typeof useBobConnection>;
}) {
  const navigation = useNavigation();
  const openLinkedThread = useOpenLinkedThread();
  const thread = useThreadShell(scopeThreadRef(environmentId, threadId));
  const overview = useEnvironmentQuery(
    connection.data?.configured && thread
      ? bobCoordination.overview({ environmentId, input: { projectId: thread.projectId } })
      : null,
  );
  const call = useAtomCommand(bobCoordination.call, { reportFailure: false });
  const [localPlans, setPlans] = useState<ListPlansOutput["plans"] | null>(null);
  const plans = localPlans ?? overview.data?.plans ?? [];
  const [localNext, setNext] = useState<string | null | undefined>(undefined);
  const next = localNext === undefined ? (overview.data?.nextPlanId ?? null) : localNext;
  const [plan, setPlan] = useState<GetPlanOutput | null>(null);
  const [items, setItems] = useState<ReadonlyArray<GetItemOutput["item"]>>([]);
  const [localCapabilities, setCapabilities] = useState<GetCapabilitiesOutput | null>(null);
  const capabilities = localCapabilities ?? overview.data?.caps;
  const [pending, setPending] = useState<BobOperationInput | null>(null);
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || overview.isPending;
  const [localError, setError] = useState<string | null>(null);
  const error = localError ?? overview.error;
  const generation = useRef(0);
  const binding = thread && connection.data?.projects[thread.projectId];
  const request = useCallback(
    async (input: BobOperationInput) => {
      const result = await call({ environmentId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    },
    [call, environmentId],
  );
  /** Applies one load unless a newer one has started since `current` was taken. */
  const load = useCallback(
    async (current: number, planId?: string, afterPlanId?: string) => {
      const loaded = await settlePromise(() => loadWork(request, binding, planId, afterPlanId));
      if (current !== generation.current) return;
      setBusy(false);
      if (AsyncResult.isFailure(loaded)) {
        setError(failureMessage(loaded, "Could not load work."));
        return;
      }
      setError(null);
      const { caps, visible, nextPlanId, detail, children } = loaded.value;
      setCapabilities(caps);
      setPlans((previous) =>
        afterPlanId ? [...(previous ?? overview.data?.plans ?? []), ...visible] : visible,
      );
      setNext(nextPlanId);
      if (detail) {
        setPlan(detail);
        setItems(children);
      }
    },
    [binding, request, overview.data?.plans],
  );
  const refresh = (planId?: string, afterPlanId?: string) => {
    const current = ++generation.current;
    setBusy(true);
    setError(null);
    return load(current, planId, afterPlanId);
  };
  const mutate = async (command: BobOperationInput) => {
    setPending(command);
    setBusy(true);
    setError(null);
    const sent = await settlePromise(() => request(command));
    if (AsyncResult.isFailure(sent)) {
      setBusy(false);
      setError(
        failureMessage(sent, "Request is awaiting confirmation. Retry with the same identifier."),
      );
      return;
    }
    setPending(null);
    await refresh(plan?.planId);
    setBusy(false);
  };
  const actions =
    plan?.state === "draft"
      ? ["start", "cancel"]
      : plan?.state === "active"
        ? ["pause", "cancel"]
        : plan?.state === "paused"
          ? ["resume", "cancel"]
          : [];
  return (
    <View className="flex-1 bg-background">
      <AppBar title="Work" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <AppText>Plans and execution coordinated by Bob</AppText>
        {(error || connection.error) && (
          <AppText accessibilityRole="alert">{error ?? connection.error}</AppText>
        )}
        {!connection.data?.configured && (
          <AppText>Connect this environment to Bob to manage work.</AppText>
        )}
        <Button
          label="Refresh"
          disabled={busy || !connection.data?.configured}
          onPress={() => void refresh(plan?.planId)}
        />
        {pending && (
          <Button label="Retry same request" disabled={busy} onPress={() => void mutate(pending)} />
        )}
        {plans.map((entry) => (
          <Button
            key={entry.planId}
            label={`${entry.itemCount} issues · ${entry.state} · ${entry.planId.slice(0, 8)}`}
            disabled={busy}
            onPress={() => void refresh(entry.planId)}
          />
        ))}
        {next && (
          <Button
            label="More plans"
            disabled={busy}
            onPress={() => void refresh(plan?.planId, next)}
          />
        )}
        {plan && (
          <>
            <AppText>
              {plan.state} · version {plan.resourceVersion}
            </AppText>
            {capabilities?.operations.includes("ControlPlan") &&
              actions.map((action) => (
                <Button
                  key={action}
                  label={action}
                  disabled={
                    busy ||
                    pending !== null ||
                    (action === "cancel" &&
                      items.some((item) =>
                        ["reserved", "running", "execution-unknown", "cancelling"].includes(
                          item.state,
                        ),
                      ))
                  }
                  onPress={() => {
                    const commandId = uuidv4();
                    void mutate({
                      operation: "ControlPlan",
                      idempotencyKey: commandId,
                      input: {
                        contractVersion: "1",
                        commandId,
                        planId: plan.planId,
                        expectedVersion: plan.resourceVersion,
                        action,
                      },
                    });
                  }}
                />
              ))}
            {items.map((item) => (
              <View key={item.itemId} className="gap-2">
                <AppText>
                  {
                    plan.definition.items.find((entry) => entry.itemId === item.itemId)?.issue
                      .identifier
                  }{" "}
                  · {item.state}
                </AppText>
                <AppText>{item.achievedMilestones.join(" → ") || "No milestone confirmed"}</AppText>
                {item.execution && (
                  <Button
                    label="Open execution thread"
                    onPress={() =>
                      openLinkedThread({
                        environmentId: EnvironmentId.make(item.execution!.thread.environmentId),
                        threadId: ThreadId.make(item.execution!.thread.threadId),
                      })
                    }
                  />
                )}
                {item.evidenceRefs.length > 0 && <AppText>{item.evidenceRefs.join(", ")}</AppText>}
              </View>
            ))}
            <AppText>
              Execution success keeps production work open until deployment and health are verified.
            </AppText>
          </>
        )}
      </ScrollView>
    </View>
  );
}
