import { scopeThreadRef } from "@t3tools/client-runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";

export const THREAD_DRAG_MIME_TYPE = "application/x-t3code-thread-ref";

export function serializeThreadDragData(threadRef: ScopedThreadRef): string {
  return JSON.stringify({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
  });
}

export function parseThreadDragData(rawValue: string): ScopedThreadRef | null {
  try {
    const parsed = JSON.parse(rawValue) as Partial<ScopedThreadRef>;
    if (
      typeof parsed.environmentId !== "string" ||
      parsed.environmentId.length === 0 ||
      typeof parsed.threadId !== "string" ||
      parsed.threadId.length === 0
    ) {
      return null;
    }
    return scopeThreadRef(parsed.environmentId, parsed.threadId);
  } catch {
    return null;
  }
}
