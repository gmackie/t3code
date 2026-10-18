import { bobOperationSchemas } from "@t3tools/contracts/bobContract";
import { randomUUID } from "~/lib/utils";
import type { EnvironmentId, ProjectId, IssueItem } from "@t3tools/contracts";
import {
  BobCoordinationError,
  planBelongsToProject,
  type BobOperationInput,
  type GetPlanOutput,
  type GetItemOutput,
  type GetCapabilitiesOutput,
  type ListPlansOutput,
  type CreatePlanOutput,
} from "@t3tools/contracts/bobCoordination";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Schema from "effect/Schema";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { bobCoordination } from "../../state/bobCoordination";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { canRetry, issueSnapshotRef, planActions } from "./work.logic";

function decode<T>(operation: string, value: unknown): T {
  return Schema.decodeUnknownSync(bobOperationSchemas.get(operation)!.output, {
    onExcessProperty: "error",
  })(value) as T;
}
export default function WorkPanel({
  environmentId,
  projectId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  const connection = useEnvironmentQuery(bobCoordination.connection({ environmentId, input: {} }));
  const call = useAtomCommand(bobCoordination.call, { reportFailure: false });
  const listIssues = useAtomCommand(serverEnvironment.listProjectIssues, { reportFailure: false });
  const [plans, setPlans] = useState<ListPlansOutput["plans"]>([]);
  const [nextPlanId, setNextPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<GetPlanOutput | null>(null);
  const [items, setItems] = useState<ReadonlyArray<GetItemOutput["item"]>>([]);
  const [issues, setIssues] = useState<ReadonlyArray<IssueItem>>([]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [capabilities, setCapabilities] = useState<GetCapabilitiesOutput | null>(null);
  const [profile, setProfile] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [baseRevision, setBaseRevision] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<BobOperationInput | null>(null);
  const generation = useRef(0);
  const binding = connection.data?.projects[projectId];
  const supports = (operation: string) => capabilities?.operations.includes(operation) === true;
  const request = useCallback(
    async (input: BobOperationInput) => {
      const result = await call({ environmentId, input });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    },
    [call, environmentId],
  );
  const loadPlan = useCallback(
    async (planId: string) => {
      const snapshot = decode<GetPlanOutput>(
        "GetPlan",
        await request({
          operation: "GetPlan",
          input: { contractVersion: "1", resourceId: planId },
        }),
      );
      if (!binding || !planBelongsToProject(snapshot.definition, binding))
        throw new Error("This plan belongs to another project.");
      const snapshots = await Promise.all(
        snapshot.items.map((item) =>
          request({
            operation: "GetItem",
            input: { contractVersion: "1", resourceId: item.itemId },
          }).then((value) => decode<GetItemOutput>("GetItem", value).item),
        ),
      );
      return { snapshot, snapshots };
    },
    [binding, request],
  );
  const refresh = useCallback(
    async (planId?: string, afterPlanId?: string) => {
      const current = ++generation.current;
      setBusy(true);
      setError(null);
      try {
        const [caps, page, detail] = await Promise.all([
          request({ operation: "GetCapabilities", input: { contractVersion: "1" } }).then((value) =>
            decode<GetCapabilitiesOutput>("GetCapabilities", value),
          ),
          request({
            operation: "ListPlans",
            input: { contractVersion: "1", limit: 50, ...(afterPlanId ? { afterPlanId } : {}) },
          }).then((value) => decode<ListPlansOutput>("ListPlans", value)),
          planId ? loadPlan(planId) : null,
        ]);
        const scoped = await Promise.all(
          page.plans.map(async (entry) => {
            const snapshot = decode<GetPlanOutput>(
              "GetPlan",
              await request({
                operation: "GetPlan",
                input: { contractVersion: "1", resourceId: entry.planId },
              }),
            );
            return binding && planBelongsToProject(snapshot.definition, binding) ? entry : null;
          }),
        );
        const visiblePlans = scoped.filter((entry) => entry !== null);
        if (current !== generation.current) return;
        setCapabilities(caps);
        setPlans((previous) => (afterPlanId ? [...previous, ...visiblePlans] : visiblePlans));
        setNextPlanId(page.nextPlanId ?? null);
        if (detail) {
          setPlan(detail.snapshot);
          setItems(detail.snapshots);
        }
      } catch (cause) {
        if (current === generation.current)
          setError(cause instanceof Error ? cause.message : "Could not refresh Bob work.");
      } finally {
        if (current === generation.current) setBusy(false);
      }
    },
    [binding, loadPlan, request],
  );
  useEffect(() => {
    setPlans([]);
    setPlan(null);
    setItems([]);
    setIssues([]);
    setSelected(new Set());
    setPending(null);
    setCapabilities(null);
    if (connection.data?.configured) void refresh();
    return () => {
      generation.current++;
    };
  }, [connection.data?.configured, environmentId, projectId, refresh]);
  const mutate = async (command: BobOperationInput) => {
    setBusy(true);
    setError(null);
    setPending(command);
    try {
      const value = await request(command);
      setPending(null);
      const planId =
        command.operation === "CreatePlan"
          ? decode<CreatePlanOutput>("CreatePlan", value).resourceId
          : plan?.planId;
      await refresh(planId);
    } catch (cause) {
      // A definite rejection permits a corrected command; uncertain delivery
      // retains the same command ID for replay.
      if (Schema.is(BobCoordinationError)(cause) && cause.status >= 400 && cause.status < 500)
        setPending(null);
      setError(cause instanceof Error ? cause.message : "Bob could not confirm the request.");
    } finally {
      setBusy(false);
    }
  };
  const createPlan = async () => {
    if (!binding || selected.size === 0) return;
    try {
      const chosen = issues.filter((issue) => selected.has(issue.id));
      const definitions = await Promise.all(
        chosen.map(async (issue) => ({
          itemId: randomUUID(),
          issue: {
            ...binding.issueProject,
            issueId: issue.id,
            identifier: issue.key,
            url: issue.url,
          },
          issueSnapshotRef: await issueSnapshotRef(issue),
          target: binding.target,
          completionTarget: "production",
        })),
      );
      const commandId = randomUUID();
      await mutate({
        operation: "CreatePlan",
        idempotencyKey: commandId,
        input: {
          contractVersion: "1",
          commandId,
          plan: { items: definitions, dependencies: [], concurrencyLimit: 1 },
        },
      });
      setSelected(new Set());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not capture issue scope.");
    }
  };
  const loadIssues = async () => {
    setBusy(true);
    setError(null);
    const result = await listIssues({ environmentId, input: { projectId, limit: 100 } });
    if (result._tag === "Success") setIssues(result.value.issues);
    else {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not load project issues.");
    }
    setBusy(false);
  };
  return (
    <ScrollArea className="h-full">
      <div className="space-y-5 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Work</h2>
            <p className="text-xs text-muted-foreground">Plans and execution coordinated by Bob</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !connection.data?.configured}
            onClick={() => void refresh(plan?.planId)}
          >
            Refresh
          </Button>
        </div>
        {!connection.data?.configured && (
          <p className="text-sm text-muted-foreground">
            Connect this environment to Bob to manage plans. Project issues and pull requests remain
            available in their existing views.
          </p>
        )}
        {(error || connection.error) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? connection.error}
          </p>
        )}
        {pending && (
          <div className="space-y-2 rounded-lg border p-3">
            <p className="text-sm">
              This request is retained for safe replay. Refresh to inspect the current state, or
              retry the same request.
            </p>
            <Button size="sm" disabled={busy} onClick={() => void mutate(pending)}>
              Retry same request
            </Button>
          </div>
        )}
        {connection.data?.configured && (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-medium">Plans</h3>
              {plans.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No plans yet. Select project issues below to create one.
                </p>
              )}
              {plans.map((entry) => (
                <Button
                  key={entry.planId}
                  variant={plan?.planId === entry.planId ? "secondary" : "outline"}
                  size="sm"
                  disabled={busy}
                  onClick={() => void refresh(entry.planId)}
                >
                  {entry.itemCount} {entry.itemCount === 1 ? "issue" : "issues"} · {entry.state} ·{" "}
                  {entry.planId.slice(0, 8)}
                </Button>
              ))}
              {nextPlanId && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void refresh(plan?.planId, nextPlanId)}
                >
                  More plans
                </Button>
              )}
            </section>
            {binding && supports("CreatePlan") && (
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">Plan from project issues</h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void loadIssues()}
                  >
                    Load issues
                  </Button>
                </div>
                {issues
                  .filter((issue) => issue.state !== "done" && issue.state !== "canceled")
                  .map((issue) => (
                    <label key={issue.id} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(issue.id)}
                        disabled={busy}
                        onChange={(event) =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(issue.id);
                            else next.delete(issue.id);
                            return next;
                          })
                        }
                      />
                      <span>
                        {issue.key} · {issue.title}
                      </span>
                    </label>
                  ))}
                <Button
                  size="sm"
                  disabled={busy || selected.size === 0 || pending !== null}
                  onClick={() => void createPlan()}
                >
                  Create plan from {selected.size} issues
                </Button>
                <p className="text-xs text-muted-foreground">
                  New plans are drafts. Execution success keeps production work open until
                  deployment and health are verified.
                </p>
              </section>
            )}
            {plan && (
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium">
                    {plan.state} · version {plan.resourceVersion}
                  </h3>
                  <div className="mt-2 flex gap-2">
                    {supports("ControlPlan") &&
                      planActions(plan.state).map((action) => (
                        <Button
                          key={action}
                          size="sm"
                          variant="outline"
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
                          onClick={() => {
                            const commandId = randomUUID();
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
                        >
                          {action}
                        </Button>
                      ))}
                  </div>
                </div>
                <label className="block space-y-1 text-xs">
                  <span>Execution profile</span>
                  <select
                    className="w-full rounded border bg-background p-2"
                    value={profile}
                    onChange={(event) => setProfile(event.target.value)}
                  >
                    <option value="">Choose an environment profile</option>
                    {connection.data.executionProfiles.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 text-xs">
                  <span>Base commit for new executions</span>
                  <Input
                    value={baseRevision}
                    placeholder="40-character commit SHA"
                    onChange={(event) => setBaseRevision(event.target.value)}
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span>Acceptance criteria for execution (one per line)</span>
                  <Textarea
                    value={acceptanceCriteria}
                    onChange={(event) => setAcceptanceCriteria(event.target.value)}
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  Load project issues to verify their current scope before execution. Requests are
                  queued in Bob; its configured dispatch worker admits them.
                </p>
                {items.map((item) => {
                  const definition = plan.definition.items.find(
                    (entry) => entry.itemId === item.itemId,
                  )!;
                  const issue = issues.find((entry) => entry.id === definition.issue.issueId);
                  return (
                    <article key={item.itemId} className="space-y-2 rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <a
                            href={definition.issue.url ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-medium"
                          >
                            {definition.issue.identifier ?? definition.issue.issueId}
                          </a>
                          <p className="text-xs text-muted-foreground">
                            {definition.target.environmentId} · {item.state}
                          </p>
                        </div>
                        <span className="text-xs">Target: {definition.completionTarget}</span>
                      </div>
                      <p className="text-xs">
                        {item.achievedMilestones.length
                          ? item.achievedMilestones.join(" → ")
                          : "No milestone confirmed"}
                      </p>
                      {item.execution?.thread && (
                        <Link
                          to="/$environmentId/$threadId"
                          params={{
                            environmentId: item.execution.thread.environmentId,
                            threadId: item.execution.thread.threadId,
                          }}
                          className="text-sm underline"
                        >
                          Open execution thread
                        </Link>
                      )}
                      {item.evidenceRefs.length > 0 && (
                        <p className="break-words text-xs text-muted-foreground">
                          Evidence: {item.evidenceRefs.join(", ")}
                        </p>
                      )}
                      {supports("RequestExecution") && item.state === "ready" && (
                        <Button
                          size="sm"
                          disabled={
                            busy ||
                            pending !== null ||
                            !profile ||
                            !acceptanceCriteria.trim() ||
                            definition.target.environmentId !== environmentId ||
                            !/^[a-f0-9]{40}$/.test(baseRevision) ||
                            !issue
                          }
                          onClick={() => {
                            if (!issue) return;
                            void issueSnapshotRef(issue)
                              .then((snapshot) => {
                                if (snapshot !== definition.issueSnapshotRef) {
                                  setError(
                                    "Issue scope changed since plan creation. Create a new plan with the current scope.",
                                  );
                                  return;
                                }
                                const requestId = randomUUID(),
                                  attemptId = randomUUID();
                                void mutate({
                                  operation: "RequestExecution",
                                  idempotencyKey: requestId,
                                  input: {
                                    contractVersion: "1",
                                    requestId,
                                    attemptId,
                                    itemId: item.itemId,
                                    planId: plan.planId,
                                    planVersion: plan.resourceVersion,
                                    issueSnapshotRef: snapshot,
                                    target: definition.target,
                                    work: {
                                      title: issue.title,
                                      instructions: issue.descriptionMarkdown || issue.title,
                                      acceptanceCriteria: acceptanceCriteria
                                        .split("\n")
                                        .map((line) => line.trim())
                                        .filter(Boolean),
                                    },
                                    workspace: {
                                      baseRevision,
                                      branch: `${issue.key}-${attemptId.slice(0, 8)}`,
                                    },
                                    executionProfileId: profile,
                                  },
                                });
                              })
                              .catch((cause) =>
                                setError(
                                  cause instanceof Error
                                    ? cause.message
                                    : "Could not capture issue scope.",
                                ),
                              );
                          }}
                        >
                          Request execution
                        </Button>
                      )}
                      {canRetry(item) && supports("RetryItem") && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || pending !== null}
                          onClick={() => {
                            const commandId = randomUUID();
                            void mutate({
                              operation: "RetryItem",
                              idempotencyKey: commandId,
                              input: {
                                contractVersion: "1",
                                commandId,
                                itemId: item.itemId,
                                expectedVersion: item.resourceVersion,
                                previousAttemptId: item.currentAttemptId,
                                reason: "Explicit retry from Work panel",
                              },
                            });
                          }}
                        >
                          Retry terminal attempt
                        </Button>
                      )}
                    </article>
                  );
                })}
                <p className="text-xs text-muted-foreground">
                  Validation, PR/CI, and deployment evidence determine later milestones. Use the
                  existing pull request and delivery views to inspect them; execution alone does not
                  complete production work.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </ScrollArea>
  );
}
