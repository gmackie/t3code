import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { LocalPluginEnvelope } from "./localPluginEvents";

const decode = Schema.decodeUnknownSync(LocalPluginEnvelope);

describe("LocalPluginEnvelope", () => {
  it("decodes a session.started envelope", () => {
    const parsed = decode({
      type: "event",
      version: 1,
      sequence: 1,
      event: {
        id: "evt-session-started",
        kind: "session.started",
        createdAt: "2026-03-23T00:00:00.000Z",
        provider: "codex",
        threadId: "thread-1",
        summary: "Session started",
      },
    });

    expect(parsed.event.kind).toBe("session.started");
  });

  it("decodes a turn.started envelope", () => {
    const parsed = decode({
      type: "event",
      version: 1,
      sequence: 2,
      event: {
        id: "evt-turn-started",
        kind: "turn.started",
        createdAt: "2026-03-23T00:00:00.000Z",
        provider: "codex",
        threadId: "thread-1",
        turnId: "turn-1",
      },
    });

    expect(parsed.event.kind).toBe("turn.started");
  });

  it("decodes a completed turn.settled envelope", () => {
    const parsed = decode({
      type: "event",
      version: 1,
      sequence: 3,
      event: {
        id: "evt-turn-settled",
        kind: "turn.settled",
        createdAt: "2026-03-23T00:00:00.000Z",
        provider: "codex",
        threadId: "thread-1",
        turnId: "turn-1",
        result: "completed",
      },
    });

    expect(parsed.event.kind).toBe("turn.settled");
  });

  it("decodes an approval.required envelope", () => {
    const parsed = decode({
      type: "event",
      version: 1,
      sequence: 4,
      event: {
        id: "evt-approval-required",
        kind: "approval.required",
        createdAt: "2026-03-23T00:00:00.000Z",
        provider: "codex",
        threadId: "thread-1",
        requestId: "request-1",
        requestKind: "command",
        detail: "Need permission",
      },
    });

    expect(parsed.event.kind).toBe("approval.required");
  });

  it("decodes a user-input.required envelope", () => {
    const parsed = decode({
      type: "event",
      version: 1,
      sequence: 5,
      event: {
        id: "evt-user-input-required",
        kind: "user-input.required",
        createdAt: "2026-03-23T00:00:00.000Z",
        provider: "codex",
        threadId: "thread-1",
        requestId: "request-2",
        questions: [
          {
            id: "question-1",
            header: "Next step",
            question: "What should happen next?",
            options: [
              {
                label: "Continue",
                description: "Proceed with the current plan.",
              },
            ],
          },
        ],
      },
    });

    expect(parsed.event.kind).toBe("user-input.required");
    if (parsed.event.kind === "user-input.required") {
      expect(parsed.event.questions).toHaveLength(1);
      expect(parsed.event.questions[0]).toMatchObject({
        id: "question-1",
        header: "Next step",
        question: "What should happen next?",
        options: [
          {
            label: "Continue",
            description: "Proceed with the current plan.",
          },
        ],
      });
    }
  });

  it("decodes a runtime.error envelope", () => {
    const parsed = decode({
      type: "event",
      version: 1,
      sequence: 6,
      event: {
        id: "evt-runtime-error",
        kind: "runtime.error",
        createdAt: "2026-03-23T00:00:00.000Z",
        provider: "codex",
        threadId: "thread-1",
        message: "Provider runtime error",
      },
    });

    expect(parsed.event.kind).toBe("runtime.error");
  });

  it("decodes a resource.limit envelope", () => {
    const parsed = decode({
      type: "event",
      version: 1,
      sequence: 7,
      event: {
        id: "evt-resource-limit",
        kind: "resource.limit",
        createdAt: "2026-03-23T00:00:00.000Z",
        provider: "codex",
        threadId: "thread-1",
        limitKind: "rate",
        message: "Rate limit reached",
      },
    });

    expect(parsed.event.kind).toBe("resource.limit");
  });

  it("rejects unknown event kinds", () => {
    expect(() =>
      decode({
        type: "event",
        version: 1,
        sequence: 1,
        event: {
          id: "evt-unknown",
          kind: "not.a.real.event",
          createdAt: "2026-03-23T00:00:00.000Z",
          provider: "codex",
          threadId: "thread-1",
        },
      }),
    ).toThrow();
  });

  it("rejects unsupported envelope versions", () => {
    expect(() =>
      decode({
        type: "event",
        version: 2,
        sequence: 1,
        event: {
          id: "evt-version",
          kind: "session.started",
          createdAt: "2026-03-23T00:00:00.000Z",
          provider: "codex",
          threadId: "thread-1",
        },
      }),
    ).toThrow();
  });
});
