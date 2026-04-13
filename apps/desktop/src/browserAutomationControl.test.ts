import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { createBrowserAutomationControl } from "./browserAutomationControl";

describe("createBrowserAutomationControl", () => {
  const threadId = ThreadId.makeUnsafe("thread-1");

  it("emits agent control state when automation claims the browser", () => {
    const events: unknown[] = [];
    const control = createBrowserAutomationControl((event) => {
      events.push(event);
    });

    control.claimAgentControl({
      threadId,
      tabId: "codex-browser",
      message: "Codex controlling browser",
    });

    expect(events).toEqual([
      {
        type: "automation-state",
        threadId,
        state: {
          status: "agent",
          tabId: "codex-browser",
          message: "Codex controlling browser",
        },
      },
    ]);
  });

  it("marks user takeover and blocks later agent claims until released", () => {
    const events: unknown[] = [];
    const control = createBrowserAutomationControl((event) => {
      events.push(event);
    });

    control.claimAgentControl({
      threadId,
      tabId: "codex-browser",
      message: "Codex controlling browser",
    });
    control.markUserControl({
      threadId,
      tabId: "codex-browser",
      message: "User took over browser control",
    });

    expect(() =>
      control.claimAgentControl({
        threadId,
        tabId: "codex-browser",
        message: "Codex controlling browser",
      }),
    ).toThrow("Browser control lost to user");

    control.releaseUserControl({
      threadId,
      tabId: "codex-browser",
    });

    control.claimAgentControl({
      threadId,
      tabId: "codex-browser",
      message: "Codex controlling browser",
    });

    expect(events).toEqual([
      {
        type: "automation-state",
        threadId,
        state: {
          status: "agent",
          tabId: "codex-browser",
          message: "Codex controlling browser",
        },
      },
      {
        type: "automation-state",
        threadId,
        state: {
          status: "user",
          tabId: "codex-browser",
          message: "User took over browser control",
        },
      },
      {
        type: "automation-state",
        threadId,
        state: {
          status: "idle",
          tabId: null,
          message: null,
        },
      },
      {
        type: "automation-state",
        threadId,
        state: {
          status: "agent",
          tabId: "codex-browser",
          message: "Codex controlling browser",
        },
      },
    ]);
  });
});
