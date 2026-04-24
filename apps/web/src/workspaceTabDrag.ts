import { scopeThreadRef } from "@t3tools/client-runtime";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";

export const WORKSPACE_TAB_DRAG_MIME_TYPE = "application/x-t3code-workspace-tab";

interface WorkspaceTabDragData {
  sourceThreadRef: ScopedThreadRef;
  tabId: string;
}

export function serializeWorkspaceTabDragData(input: WorkspaceTabDragData): string {
  return JSON.stringify({
    environmentId: input.sourceThreadRef.environmentId,
    threadId: input.sourceThreadRef.threadId,
    tabId: input.tabId,
  });
}

export function parseWorkspaceTabDragData(rawValue: string): WorkspaceTabDragData | null {
  try {
    const parsed = JSON.parse(rawValue) as Partial<{
      environmentId: string;
      threadId: string;
      tabId: string;
    }>;
    if (
      typeof parsed.environmentId !== "string" ||
      parsed.environmentId.length === 0 ||
      typeof parsed.threadId !== "string" ||
      parsed.threadId.length === 0 ||
      typeof parsed.tabId !== "string" ||
      parsed.tabId.length === 0
    ) {
      return null;
    }
    return {
      sourceThreadRef: scopeThreadRef(
        parsed.environmentId as EnvironmentId,
        parsed.threadId as ThreadId,
      ),
      tabId: parsed.tabId,
    };
  } catch {
    return null;
  }
}
