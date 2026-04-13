import {
  ThreadId,
  type BrowserAutomationRequest,
  type BrowserAutomationResult,
} from "@t3tools/contracts";

import type { BrowserManager } from "./browserManager";

const CODEX_BROWSER_AUTOMATION_TAB_ID = "codex-browser";

export interface BrowserAutomationService {
  handleRequest: (request: BrowserAutomationRequest) => Promise<BrowserAutomationResult>;
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
            selector: request.selector,
          });
          return {
            message: `Clicked ${request.selector}`,
          };
        case "type":
          await browserManager.typeText({
            ...target,
            selector: request.selector,
            text: request.text,
            ...(request.submit !== undefined ? { submit: request.submit } : {}),
          });
          return {
            message: `Typed into ${request.selector}`,
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
    },
  };
}
