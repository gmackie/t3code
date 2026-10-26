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
import { useCallback, useEffect, useRef, useState } from "react";
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
const decode = <A,>(operation: string, value: unknown): A =>
  Schema.decodeUnknownSync(bobOperationSchemas.get(operation)!.output)(value) as A;
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

export function WorkRouteScreen(props: Props) {
  const { environmentId, threadId } = props.route.params;
  const navigation = useNavigation();
  const openLinkedThread = useOpenLinkedThread();
  const thread = useThreadShell(scopeThreadRef(environmentId, threadId));
  const connection = useEnvironmentQuery(bobCoordination.connection({ environmentId, input: {} }));
  const call = useAtomCommand(bobCoordination.call, { reportFailure: false });
  const [plans, setPlans] = useState<ListPlansOutput["plans"]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [plan, setPlan] = useState<GetPlanOutput | null>(null);
  const [items, setItems] = useState<ReadonlyArray<GetItemOutput["item"]>>([]);
  const [capabilities, setCapabilities] = useState<GetCapabilitiesOutput | null>(null);
  const [pending, setPending] = useState<BobOperationInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const refresh = useCallback(
    async (planId?: string, afterPlanId?: string) => {
      const current = ++generation.current;
      setBusy(true);
      setError(null);
      const loaded = await settlePromise(() => loadWork(request, binding, planId, afterPlanId));
      if (current !== generation.current) return;
      setBusy(false);
      if (AsyncResult.isFailure(loaded)) {
        setError(failureMessage(loaded, "Could not load work."));
        return;
      }
      const { caps, visible, nextPlanId, detail, children } = loaded.value;
      setCapabilities(caps);
      setPlans((previous) => (afterPlanId ? [...previous, ...visible] : visible));
      setNext(nextPlanId);
      if (detail) {
        setPlan(detail);
        setItems(children);
      }
    },
    [binding, request],
  );
  useEffect(() => {
    setPlans([]);
    setPlan(null);
    setItems([]);
    setPending(null);
    if (connection.data?.configured) void refresh();
    return () => {
      generation.current++;
    };
  }, [connection.data?.configured, environmentId, threadId, refresh]);
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
