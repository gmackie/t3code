import {
  ThreadId,
  type BrowserAutomationRequest,
  type BrowserAutomationResult,
  type BrowserAutomationTarget,
} from "@t3tools/contracts";

import type { BrowserManager } from "./browserManager";

const CODEX_BROWSER_AUTOMATION_TAB_ID = "codex-browser";

export interface BrowserAutomationService {
  handleRequest: (request: BrowserAutomationRequest) => Promise<BrowserAutomationResult>;
}

function readActionLabel(request: BrowserAutomationRequest): string {
  switch (request.type) {
    case "navigate":
      return "Navigate";
    case "click":
      return "Click";
    case "type":
      return "Type";
    case "wait":
      return "Wait";
    case "inspect":
      return "Inspect";
    case "screenshot":
      return "Screenshot";
    case "diagnostics":
      return "Diagnostics";
  }
}

function describeTarget(target: BrowserAutomationTarget): string {
  if (target.selector) {
    return target.selector;
  }
  const parts: string[] = [];
  if (target.role) {
    parts.push(target.role);
  }
  if (target.name) {
    parts.push(`"${target.name}"`);
  } else if (target.text) {
    parts.push(`text "${target.text}"`);
  }
  return parts.length > 0 ? parts.join(" ") : "target";
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function collectFailureEvidence(
  browserManager: BrowserManager,
  request: BrowserAutomationRequest,
  target: { threadId: ThreadId; tabId: string },
): Promise<Partial<BrowserAutomationResult>> {
  const evidence: Partial<BrowserAutomationResult> = {};

  if (request.type !== "diagnostics") {
    try {
      Object.assign(evidence, await browserManager.diagnostics(target));
    } catch {}
  }

  if (request.type !== "screenshot") {
    try {
      evidence.screenshotDataUrl = await browserManager.screenshot(target);
    } catch {}
  }

  return evidence;
}

export function createBrowserAutomationService(
  browserManager: BrowserManager,
): BrowserAutomationService {
  return {
    handleRequest: async (request) => {
      const target = {
        threadId: ThreadId.makeUnsafe(request.threadId),
        tabId: CODEX_BROWSER_AUTOMATION_TAB_ID,
      };
      try {
        browserManager.claimAutomationControl({
          ...target,
          message: "Codex controlling browser",
        });

        switch (request.type) {
          case "navigate":
            await browserManager.navigate({
              ...target,
              url: request.url,
            });
            return {
              message: `Navigated to ${request.url}`,
              url: request.url,
            };
          case "click":
            await browserManager.click({
              ...target,
              target: request.target,
            });
            return {
              message: `Clicked ${describeTarget(request.target)}`,
            };
          case "type":
            await browserManager.typeText({
              ...target,
              target: request.target,
              text: request.text,
              ...(request.submit !== undefined ? { submit: request.submit } : {}),
              ...(request.clear !== undefined ? { clear: request.clear } : {}),
            });
            return {
              message: `Typed into ${describeTarget(request.target)}`,
            };
          case "wait":
            await browserManager.wait({
              ...target,
              ...(request.selector ? { selector: request.selector } : {}),
              ...(request.text ? { text: request.text } : {}),
              ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
            });
            return {
              message: "Wait condition satisfied.",
            };
          case "inspect":
            return {
              message: "Inspected current page.",
              ...(await browserManager.inspect(target)),
            };
          case "screenshot":
            return {
              message: "Captured browser screenshot.",
              screenshotDataUrl: await browserManager.screenshot(target),
            };
          case "diagnostics":
            return {
              message: "Collected browser diagnostics.",
              ...(await browserManager.diagnostics(target)),
            };
        }
      } catch (error) {
        const message = readErrorMessage(error);
        return {
          message: `${readActionLabel(request)} failed: ${message}`,
          error: message,
          ...(await collectFailureEvidence(browserManager, request, target)),
        };
      }
    },
  };
}
