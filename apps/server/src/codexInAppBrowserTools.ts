import type {
  BrowserAutomationRequest,
  BrowserAutomationResult,
  BrowserAutomationTarget,
} from "@t3tools/contracts";
import type { DesktopBrowserAutomationClient } from "./desktopBrowserAutomationClient";

export interface CodexDynamicToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CodexDynamicToolCallParams {
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  arguments: unknown;
}

export interface CodexDynamicToolResponse {
  contentItems: Array<
    { type: "inputText"; text: string } | { type: "inputImage"; imageUrl: string }
  >;
  success: boolean;
}

export type CodexDynamicToolCallHandler = (
  params: CodexDynamicToolCallParams,
) => Promise<CodexDynamicToolResponse>;

const SHARED_THREAD_ID_PROPERTY: Record<string, unknown> = {
  type: "string",
  description: "Owning T3 Code thread id.",
};

function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
  description: string,
): Record<string, unknown> {
  return {
    type: "object",
    description,
    additionalProperties: false,
    properties,
    required,
  };
}

export const CODEX_IN_APP_BROWSER_DYNAMIC_TOOLS: CodexDynamicToolSpec[] = [
  {
    name: "browser.navigate",
    description: "Open a URL in the shared in-app Chromium session for this thread.",
    inputSchema: objectSchema(
      {
        threadId: SHARED_THREAD_ID_PROPERTY,
        url: { type: "string", description: "Absolute http or https URL to load." },
      },
      ["url"],
      "Navigate the thread browser to a URL.",
    ),
  },
  {
    name: "browser.click",
    description:
      "Click a visible element in the in-app browser using a selector or semantic target.",
    inputSchema: objectSchema(
      {
        threadId: SHARED_THREAD_ID_PROPERTY,
        selector: { type: "string", description: "CSS selector for the target element." },
        text: { type: "string", description: "Visible text to match on the target element." },
        role: { type: "string", description: "Accessible role to match, such as button or link." },
        name: { type: "string", description: "Accessible name to match for the target element." },
        index: {
          type: "number",
          description: "Zero-based match index when multiple results exist.",
        },
      },
      [],
      "Click an element in the current page.",
    ),
  },
  {
    name: "browser.type",
    description: "Type into an element in the in-app browser using a selector or semantic target.",
    inputSchema: objectSchema(
      {
        threadId: SHARED_THREAD_ID_PROPERTY,
        selector: { type: "string", description: "CSS selector for the editable element." },
        role: {
          type: "string",
          description: "Accessible role to match for the editable element, such as textbox.",
        },
        name: {
          type: "string",
          description: "Accessible name to match for the editable element.",
        },
        index: {
          type: "number",
          description: "Zero-based match index when multiple results exist.",
        },
        text: { type: "string", description: "Text to enter into the target element." },
        submit: { type: "boolean", description: "Whether to submit the closest form afterward." },
        clear: {
          type: "boolean",
          description: "Whether to clear the current value before typing.",
        },
      },
      ["text"],
      "Type text into an element in the current page.",
    ),
  },
  {
    name: "browser.wait",
    description: "Wait for a selector or visible text to appear in the current page.",
    inputSchema: objectSchema(
      {
        threadId: SHARED_THREAD_ID_PROPERTY,
        selector: { type: "string", description: "CSS selector to wait for." },
        text: { type: "string", description: "Visible text to wait for." },
        role: {
          type: "string",
          description: "Accessible role to wait for, such as button or link.",
        },
        name: { type: "string", description: "Accessible name to wait for on the target element." },
        index: {
          type: "number",
          description: "Zero-based match index when multiple role/name matches exist.",
        },
        urlIncludes: {
          type: "string",
          description: "Substring that should appear in the current URL.",
        },
        titleIncludes: {
          type: "string",
          description: "Substring that should appear in the document title.",
        },
        timeoutMs: { type: "number", description: "Maximum wait time in milliseconds." },
      },
      [],
      "Wait for page state to change.",
    ),
  },
  {
    name: "browser.inspect",
    description:
      "Read the current page URL, title, text snapshot, and matching elements from the in-app browser.",
    inputSchema: objectSchema(
      {
        threadId: SHARED_THREAD_ID_PROPERTY,
        selector: { type: "string", description: "CSS selector to inspect." },
        text: { type: "string", description: "Visible text to inspect on the target element." },
        role: {
          type: "string",
          description: "Accessible role to inspect, such as button or link.",
        },
        name: { type: "string", description: "Accessible name to inspect on the target element." },
        index: {
          type: "number",
          description: "Zero-based match index when multiple role/name matches exist.",
        },
      },
      [],
      "Inspect the current page state.",
    ),
  },
  {
    name: "browser.screenshot",
    description: "Capture a screenshot from the in-app browser.",
    inputSchema: objectSchema(
      {
        threadId: SHARED_THREAD_ID_PROPERTY,
      },
      [],
      "Capture a screenshot of the current page.",
    ),
  },
  {
    name: "browser.diagnostics",
    description: "Read browser diagnostics including console messages and network failures.",
    inputSchema: objectSchema(
      {
        threadId: SHARED_THREAD_ID_PROPERTY,
      },
      [],
      "Collect diagnostics from the current page.",
    ),
  },
];

function formatBrowserInspectSummary(result: BrowserAutomationResult): string {
  const lines = [
    `Page: ${result.title?.trim() || result.url || "Untitled page"}`,
    ...(result.url ? [`URL: ${result.url}`] : []),
    ...(result.loadingState ? [`Loading: ${result.loadingState}`] : []),
    ...(result.text ? [`Text preview: ${result.text.slice(0, 240)}`] : []),
  ];

  if ((result.elements?.length ?? 0) > 0) {
    lines.push(
      `Elements: ${result.elements
        ?.slice(0, 3)
        .map((element) => `${element.role} "${element.name}"`)
        .join(" · ")}`,
    );
  }

  return lines.join("\n");
}

function formatBrowserDiagnosticsSummary(result: BrowserAutomationResult): string {
  const lines = [
    `Page: ${result.title?.trim() || result.url || "Untitled page"}`,
    ...(result.url ? [`URL: ${result.url}`] : []),
    ...(result.loadingState ? [`Loading: ${result.loadingState}`] : []),
    ...(result.lastError ? [`Last error: ${result.lastError}`] : []),
    `Console messages: ${result.consoleMessages?.length ?? 0}`,
    `Network errors: ${result.networkErrors?.length ?? 0}`,
  ];

  if ((result.consoleMessages?.length ?? 0) > 0) {
    lines.push(`Console sample: ${result.consoleMessages?.slice(0, 2).join(" · ")}`);
  }
  if ((result.networkErrors?.length ?? 0) > 0) {
    lines.push(`Network sample: ${result.networkErrors?.slice(0, 2).join(" · ")}`);
  }

  return lines.join("\n");
}

function formatGenericBrowserSuccess(result: BrowserAutomationResult): string {
  const lines = [
    result.message,
    ...(result.title?.trim() ? [`Page: ${result.title.trim()}`] : []),
    ...(result.url ? [`URL: ${result.url}`] : []),
  ];
  return lines.join("\n");
}

function formatBrowserFailureSummary(result: BrowserAutomationResult): string {
  const lines = [
    `Failure: ${result.error ?? result.message}`,
    ...(result.title?.trim() ? [`Page: ${result.title.trim()}`] : []),
    ...(result.url ? [`URL: ${result.url}`] : []),
    ...(result.loadingState ? [`Loading: ${result.loadingState}`] : []),
    ...(result.lastError ? [`Last error: ${result.lastError}`] : []),
    `Console messages: ${result.consoleMessages?.length ?? 0}`,
    `Network errors: ${result.networkErrors?.length ?? 0}`,
  ];

  if ((result.consoleMessages?.length ?? 0) > 0) {
    lines.push(`Console sample: ${result.consoleMessages?.slice(0, 2).join(" · ")}`);
  }
  if ((result.networkErrors?.length ?? 0) > 0) {
    lines.push(`Network sample: ${result.networkErrors?.slice(0, 2).join(" · ")}`);
  }

  return lines.join("\n");
}

function formatBrowserResultText(tool: string, result: BrowserAutomationResult): string {
  if (result.error !== undefined) {
    return formatBrowserFailureSummary(result);
  }

  switch (tool) {
    case "browser.inspect":
      return formatBrowserInspectSummary(result);
    case "browser.diagnostics":
      return formatBrowserDiagnosticsSummary(result);
    default:
      return formatGenericBrowserSuccess(result);
  }
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBrowserTarget(
  record: Record<string, unknown>,
  options: { allowText: boolean },
): BrowserAutomationTarget | null {
  const selector = readString(record, "selector");
  const text = options.allowText ? readString(record, "text") : null;
  const role = readString(record, "role");
  const name = readString(record, "name");
  const index = readNumber(record, "index");

  const target: BrowserAutomationTarget = {
    ...(selector ? { selector } : {}),
    ...(text ? { text } : {}),
    ...(role ? { role } : {}),
    ...(name ? { name } : {}),
    ...(index !== undefined ? { index } : {}),
  };

  return Object.keys(target).length > 0 ? target : null;
}

function toBrowserAutomationRequest(params: CodexDynamicToolCallParams): BrowserAutomationRequest {
  const args = readObject(params.arguments) ?? {};

  switch (params.tool) {
    case "browser.navigate": {
      const url = readString(args, "url");
      if (!url) {
        throw new Error("browser.navigate requires a url string.");
      }
      return {
        type: "navigate",
        threadId: params.threadId,
        url,
      };
    }
    case "browser.click": {
      const target = readBrowserTarget(args, { allowText: true });
      if (!target) {
        throw new Error(
          "browser.click requires at least one target hint such as selector, text, role, or name.",
        );
      }
      return {
        type: "click",
        threadId: params.threadId,
        target,
      };
    }
    case "browser.type": {
      const text = readString(args, "text");
      const submit = readBoolean(args, "submit");
      const clear = readBoolean(args, "clear");
      const target = readBrowserTarget(args, { allowText: false });
      if (!target || text === null) {
        throw new Error(
          "browser.type requires a text string and at least one target hint such as selector, role, or name.",
        );
      }
      return {
        type: "type",
        threadId: params.threadId,
        target,
        text,
        ...(submit !== undefined ? { submit } : {}),
        ...(clear !== undefined ? { clear } : {}),
      };
    }
    case "browser.wait": {
      const target = readBrowserTarget(args, { allowText: false });
      const selector = readString(args, "selector");
      const text = readString(args, "text");
      const urlIncludes = readString(args, "urlIncludes");
      const titleIncludes = readString(args, "titleIncludes");
      const timeoutMs = readNumber(args, "timeoutMs");
      return {
        type: "wait",
        threadId: params.threadId,
        ...(target ? { target } : {}),
        ...(selector ? { selector } : {}),
        ...(text ? { text } : {}),
        ...(urlIncludes ? { urlIncludes } : {}),
        ...(titleIncludes ? { titleIncludes } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      };
    }
    case "browser.inspect": {
      const target = readBrowserTarget(args, { allowText: true });
      return {
        type: "inspect",
        threadId: params.threadId,
        ...(target ? { target } : {}),
      };
    }
    case "browser.screenshot":
      return { type: "screenshot", threadId: params.threadId };
    case "browser.diagnostics":
      return { type: "diagnostics", threadId: params.threadId };
    default:
      throw new Error(`Unsupported browser tool: ${params.tool}`);
  }
}

export function createCodexInAppBrowserDynamicToolHandler(
  client: DesktopBrowserAutomationClient | null,
): CodexDynamicToolCallHandler {
  return async (params) => {
    if (!client) {
      return {
        contentItems: [
          {
            type: "inputText",
            text: "Desktop browser automation is unavailable in this runtime.",
          },
        ],
        success: false,
      };
    }

    try {
      const result = await client.sendRequest(toBrowserAutomationRequest(params));
      const contentItems: CodexDynamicToolResponse["contentItems"] = [
        {
          type: "inputText",
          text: formatBrowserResultText(params.tool, result),
        },
      ];
      if (result.screenshotDataUrl) {
        contentItems.push({
          type: "inputImage",
          imageUrl: result.screenshotDataUrl,
        });
      }
      return {
        contentItems,
        success: result.error === undefined,
      };
    } catch (error) {
      return {
        contentItems: [
          {
            type: "inputText",
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        success: false,
      };
    }
  };
}
