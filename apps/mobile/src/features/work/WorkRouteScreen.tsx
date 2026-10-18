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
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { AppText } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { ScreenHeader } from "../../components/ScreenHeader";
import { bobCoordination } from "../../state/bobCoordination";
import { useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { uuidv4 } from "../../lib/uuid";

type Props = StaticScreenProps<{ environmentId: EnvironmentId; threadId: ThreadId }>;
const decode = <A,>(operation: string, value: unknown): A =>
  Schema.decodeUnknownSync(bobOperationSchemas.get(operation)!.output)(value) as A;
export function WorkRouteScreen(props: Props) {
  const { environmentId, threadId } = props.route.params;
  const navigation = useNavigation();
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
      try {
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
        if (current !== generation.current) return;
        setCapabilities(caps);
        setPlans((previous) => (afterPlanId ? [...previous, ...visible] : visible));
        setNext(page.nextPlanId ?? null);
        if (detail) {
          setPlan(detail);
          setItems(children);
        }
      } catch (cause) {
        if (current === generation.current)
          setError(cause instanceof Error ? cause.message : "Could not load work.");
      } finally {
        if (current === generation.current) setBusy(false);
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
    try {
      await request(command);
      setPending(null);
      await refresh(plan?.planId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Request is awaiting confirmation. Retry with the same identifier.",
      );
    } finally {
      setBusy(false);
    }
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
      <ScreenHeader title="Work" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <AppText>Plans and execution coordinated by Bob</AppText>
        {(error || connection.error) && (
          <AppText accessibilityRole="alert">{error ?? connection.error}</AppText>
        )}
        {!connection.data?.configured && (
          <AppText>Connect this environment to Bob to manage work.</AppText>
        )}
        <MaterialButton
          label="Refresh"
          disabled={busy || !connection.data?.configured}
          onPress={() => void refresh(plan?.planId)}
        />
        {pending && (
          <MaterialButton
            label="Retry same request"
            disabled={busy}
            onPress={() => void mutate(pending)}
          />
        )}
        {plans.map((entry) => (
          <MaterialButton
            key={entry.planId}
            label={`${entry.itemCount} issues · ${entry.state} · ${entry.planId.slice(0, 8)}`}
            disabled={busy}
            onPress={() => void refresh(entry.planId)}
          />
        ))}
        {next && (
          <MaterialButton
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
                <MaterialButton
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
                  <MaterialButton
                    label="Open execution thread"
                    onPress={() =>
                      navigation.navigate("Thread", {
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
