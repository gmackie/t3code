export interface BrowserAutomationNavigateRequest {
  type: "navigate";
  threadId: string;
  url: string;
}

export interface BrowserAutomationClickRequest {
  type: "click";
  threadId: string;
  selector: string;
}

export interface BrowserAutomationTypeRequest {
  type: "type";
  threadId: string;
  selector: string;
  text: string;
  submit?: boolean;
}

export interface BrowserAutomationWaitRequest {
  type: "wait";
  threadId: string;
  selector?: string;
  text?: string;
  timeoutMs?: number;
}

export interface BrowserAutomationInspectRequest {
  type: "inspect";
  threadId: string;
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
  url?: string;
  title?: string | null;
  text?: string;
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
