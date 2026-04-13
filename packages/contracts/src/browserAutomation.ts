export interface BrowserAutomationTarget {
  selector?: string;
  text?: string;
  role?: string;
  name?: string;
  index?: number;
}

export interface BrowserAutomationNavigateRequest {
  type: "navigate";
  threadId: string;
  url: string;
}

export interface BrowserAutomationClickRequest {
  type: "click";
  threadId: string;
  target: BrowserAutomationTarget;
}

export interface BrowserAutomationTypeRequest {
  type: "type";
  threadId: string;
  target: BrowserAutomationTarget;
  text: string;
  submit?: boolean;
  clear?: boolean;
}

export interface BrowserAutomationWaitRequest {
  type: "wait";
  threadId: string;
  target?: BrowserAutomationTarget;
  selector?: string;
  text?: string;
  urlIncludes?: string;
  titleIncludes?: string;
  timeoutMs?: number;
}

export interface BrowserAutomationElementSummary {
  role: string;
  name: string;
  text?: string;
  disabled?: boolean;
}

export interface BrowserAutomationInspectRequest {
  type: "inspect";
  threadId: string;
  target?: BrowserAutomationTarget;
}

export interface BrowserAutomationScreenshotRequest {
  type: "screenshot";
  threadId: string;
}

export interface BrowserAutomationDiagnosticsRequest {
  type: "diagnostics";
  threadId: string;
}

export type BrowserAutomationRequest =
  | BrowserAutomationNavigateRequest
  | BrowserAutomationClickRequest
  | BrowserAutomationTypeRequest
  | BrowserAutomationWaitRequest
  | BrowserAutomationInspectRequest
  | BrowserAutomationScreenshotRequest
  | BrowserAutomationDiagnosticsRequest;

export interface BrowserAutomationResult {
  message: string;
  error?: string;
  url?: string;
  title?: string | null;
  text?: string;
  loadingState?: "loading" | "interactive" | "complete";
  lastError?: string | null;
  elements?: BrowserAutomationElementSummary[];
  screenshotDataUrl?: string;
  consoleMessages?: string[];
  networkErrors?: string[];
}

export interface DesktopBrowserAutomationRequestEnvelope {
  kind: "desktop-browser-automation-request";
  requestId: string;
  payload: BrowserAutomationRequest;
}

export interface DesktopBrowserAutomationSuccessEnvelope {
  kind: "desktop-browser-automation-response";
  requestId: string;
  ok: true;
  result: BrowserAutomationResult;
}

export interface DesktopBrowserAutomationErrorEnvelope {
  kind: "desktop-browser-automation-response";
  requestId: string;
  ok: false;
  error: string;
}

export type DesktopBrowserAutomationResponseEnvelope =
  | DesktopBrowserAutomationSuccessEnvelope
  | DesktopBrowserAutomationErrorEnvelope;
