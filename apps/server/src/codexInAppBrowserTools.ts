import type { BrowserAutomationRequest, BrowserAutomationResult } from "@t3tools/contracts";
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
    description: "Click a visible element in the in-app browser using a CSS selector.",
    inputSchema: objectSchema(
      {
        threadId: SHARED_THREAD_ID_PROPERTY,
        selector: { type: "string", description: "CSS selector for the target element." },
      },
      ["selector"],
      "Click an element in the current page.",
    ),
  },
  {
    name: "browser.type",
    description: "Type into an element in the in-app browser using a CSS selector.",
    inputSchema: objectSchema(
      {
        threadId: SHARED_THREAD_ID_PROPERTY,
        selector: { type: "string", description: "CSS selector for the editable element." },
        text: { type: "string", description: "Text to enter into the target element." },
        submit: { type: "boolean", description: "Whether to submit the closest form afterward." },
      },
      ["selector", "text"],
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
        timeoutMs: { type: "number", description: "Maximum wait time in milliseconds." },
      },
      [],
      "Wait for page state to change.",
    ),
  },
  {
    name: "browser.inspect",
    description: "Read the current page URL, title, and a text snapshot from the in-app browser.",
    inputSchema: objectSchema(
      {
        threadId: SHARED_THREAD_ID_PROPERTY,
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

function stringifyResult(result: BrowserAutomationResult): string {
  return JSON.stringify(result, null, 2);
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
      const selector = readString(args, "selector");
      if (!selector) {
        throw new Error("browser.click requires a selector string.");
      }
      return {
        type: "click",
        threadId: params.threadId,
        selector,
      };
    }
    case "browser.type": {
      const selector = readString(args, "selector");
      const text = readString(args, "text");
      const submit = readBoolean(args, "submit");
      if (!selector || text === null) {
        throw new Error("browser.type requires selector and text strings.");
      }
      return {
        type: "type",
        threadId: params.threadId,
        selector,
        text,
        ...(submit !== undefined ? { submit } : {}),
      };
    }
    case "browser.wait": {
      const selector = readString(args, "selector");
      const text = readString(args, "text");
      const timeoutMs = readNumber(args, "timeoutMs");
      return {
        type: "wait",
        threadId: params.threadId,
        ...(selector ? { selector } : {}),
        ...(text ? { text } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      };
    }
    case "browser.inspect":
      return { type: "inspect", threadId: params.threadId };
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
          text: stringifyResult(result),
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
        success: true,
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
