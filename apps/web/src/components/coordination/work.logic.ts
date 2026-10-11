import type { IssueItem } from "@t3tools/contracts";
import type { GetPlanOutput, GetItemOutput } from "@t3tools/contracts/bobCoordination";

export function issueScope(
  issue: Pick<IssueItem, "id" | "key" | "title" | "descriptionMarkdown">,
): string {
  return JSON.stringify({
    id: issue.id,
    key: issue.key,
    title: issue.title,
    description: issue.descriptionMarkdown ?? "",
  });
}
export async function issueSnapshotRef(
  issue: Pick<IssueItem, "id" | "key" | "title" | "descriptionMarkdown">,
): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(issueScope(issue)));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function planActions(
  state: GetPlanOutput["state"],
): ReadonlyArray<"start" | "pause" | "resume" | "cancel"> {
  if (state === "draft") return ["start", "cancel"];
  if (state === "active") return ["pause", "cancel"];
  if (state === "paused") return ["resume", "cancel"];
  return [];
}
export function canRetry(item: GetItemOutput["item"]): boolean {
  return item.currentAttemptId != null && ["failed", "cancelled"].includes(item.state);
}
