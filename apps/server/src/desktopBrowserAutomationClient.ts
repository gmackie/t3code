import type { BrowserAutomationRequest, BrowserAutomationResult } from "@t3tools/contracts";

export interface DesktopBrowserAutomationClient {
  sendRequest: (request: BrowserAutomationRequest) => Promise<BrowserAutomationResult>;
}
