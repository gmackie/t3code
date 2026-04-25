import type {
  ApprovalRequestId,
  ClientOrchestrationCommand,
  ProviderApprovalDecision,
  ProviderUserInputAnswers,
  ThreadId,
} from "@t3tools/contracts";

import { createBearerHeaders } from "@t3tools/client-runtime";

function buildDispatchUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.pathname = "/api/orchestration/dispatch";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function createCommandId(): ClientOrchestrationCommand["commandId"] {
  return `mobile-command-${Date.now()}-${Math.random().toString(16).slice(2)}` as never;
}

function createMessageId(): string {
  return `mobile-message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as { readonly error?: string };
    return parsed.error || text;
  } catch {
    return text;
  }
}

async function dispatchCommand(input: {
  readonly httpBaseUrl: string;
  readonly sessionToken: string;
  readonly command: ClientOrchestrationCommand;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<void> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const response = await fetchImpl(buildDispatchUrl(input.httpBaseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...createBearerHeaders(input.sessionToken),
    },
    body: JSON.stringify(input.command),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Unable to dispatch thread action."));
  }
}

export function sendThreadPrompt(input: {
  readonly httpBaseUrl: string;
  readonly sessionToken: string;
  readonly threadId: string;
  readonly text: string;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<void> {
  const trimmedText = input.text.trim();
  if (!trimmedText) {
    throw new Error("Prompt text is required.");
  }

  return dispatchCommand({
    ...input,
    command: {
      type: "thread.turn.start",
      commandId: createCommandId(),
      threadId: input.threadId as ThreadId,
      message: {
        messageId: createMessageId() as never,
        role: "user",
        text: trimmedText,
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: new Date().toISOString(),
    },
  });
}

export function approveThreadRequest(input: {
  readonly httpBaseUrl: string;
  readonly sessionToken: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly decision: ProviderApprovalDecision;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<void> {
  return dispatchCommand({
    ...input,
    command: {
      type: "thread.approval.respond",
      commandId: createCommandId(),
      threadId: input.threadId as ThreadId,
      requestId: input.requestId as ApprovalRequestId,
      decision: input.decision,
      createdAt: new Date().toISOString(),
    },
  });
}

export function answerThreadUserInput(input: {
  readonly httpBaseUrl: string;
  readonly sessionToken: string;
  readonly threadId: string;
  readonly requestId: string;
  readonly answers: ProviderUserInputAnswers;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<void> {
  return dispatchCommand({
    ...input,
    command: {
      type: "thread.user-input.respond",
      commandId: createCommandId(),
      threadId: input.threadId as ThreadId,
      requestId: input.requestId as ApprovalRequestId,
      answers: input.answers,
      createdAt: new Date().toISOString(),
    },
  });
}

export function interruptThreadTurn(input: {
  readonly httpBaseUrl: string;
  readonly sessionToken: string;
  readonly threadId: string;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<void> {
  return dispatchCommand({
    ...input,
    command: {
      type: "thread.turn.interrupt",
      commandId: createCommandId(),
      threadId: input.threadId as ThreadId,
      createdAt: new Date().toISOString(),
    },
  });
}

export function stopThreadSession(input: {
  readonly httpBaseUrl: string;
  readonly sessionToken: string;
  readonly threadId: string;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<void> {
  return dispatchCommand({
    ...input,
    command: {
      type: "thread.session.stop",
      commandId: createCommandId(),
      threadId: input.threadId as ThreadId,
      createdAt: new Date().toISOString(),
    },
  });
}
