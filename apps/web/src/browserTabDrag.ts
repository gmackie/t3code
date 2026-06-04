import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";

export const BROWSER_TAB_DRAG_MIME_TYPE = "application/x-t3code-browser-tab";

export interface BrowserTabDragData {
  sourceThreadRef: ReturnType<typeof scopeThreadRef>;
  tabId: string;
}

export function serializeBrowserTabDragData(input: BrowserTabDragData): string {
  return JSON.stringify({
    environmentId: input.sourceThreadRef.environmentId,
    threadId: input.sourceThreadRef.threadId,
    tabId: input.tabId,
  });
}

export function parseBrowserTabDragData(rawValue: string): BrowserTabDragData | null {
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
