import type { BrowserAutomationStateEvent, BrowserEvent, ThreadId } from "@t3tools/contracts";

interface BrowserAutomationControlState {
  status: "idle" | "agent" | "user";
  tabId: string | null;
  message: string | null;
}

interface BrowserAutomationControlTarget {
  threadId: ThreadId;
  tabId: string;
}

interface BrowserAutomationControlUpdate extends BrowserAutomationControlTarget {
  message: string | null;
}

export interface BrowserAutomationControl {
  claimAgentControl: (input: BrowserAutomationControlUpdate) => void;
  markUserControl: (input: BrowserAutomationControlUpdate) => void;
  releaseUserControl: (input: BrowserAutomationControlTarget) => void;
  clearThread: (threadId: ThreadId) => void;
  isAgentControlled: (input: BrowserAutomationControlTarget) => boolean;
}

const IDLE_STATE: BrowserAutomationControlState = Object.freeze({
  status: "idle",
  tabId: null,
  message: null,
});

function statesEqual(
  left: BrowserAutomationControlState,
  right: BrowserAutomationControlState,
): boolean {
  return (
    left.status === right.status && left.tabId === right.tabId && left.message === right.message
  );
}

function emitAutomationState(
  emitEvent: (event: BrowserEvent) => void,
  threadId: ThreadId,
  state: BrowserAutomationControlState,
): void {
  const event: BrowserAutomationStateEvent = {
    type: "automation-state",
    threadId,
    state,
  };
  emitEvent(event);
}

export function createBrowserAutomationControl(
  emitEvent: (event: BrowserEvent) => void,
): BrowserAutomationControl {
  const states = new Map<ThreadId, BrowserAutomationControlState>();

  const updateState = (threadId: ThreadId, nextState: BrowserAutomationControlState): void => {
    const currentState = states.get(threadId) ?? IDLE_STATE;
    if (statesEqual(currentState, nextState)) {
      return;
    }
    if (nextState.status === "idle") {
      states.delete(threadId);
    } else {
      states.set(threadId, nextState);
    }
    emitAutomationState(emitEvent, threadId, nextState);
  };

  return {
    claimAgentControl: ({ threadId, tabId, message }) => {
      const currentState = states.get(threadId) ?? IDLE_STATE;
      if (currentState.status === "user") {
        throw new Error("Browser control lost to user");
      }
      updateState(threadId, {
        status: "agent",
        tabId,
        message,
      });
    },
    markUserControl: ({ threadId, tabId, message }) => {
      updateState(threadId, {
        status: "user",
        tabId,
        message,
      });
    },
    releaseUserControl: ({ threadId, tabId }) => {
      const currentState = states.get(threadId) ?? IDLE_STATE;
      if (currentState.status !== "user" || currentState.tabId !== tabId) {
        return;
      }
      updateState(threadId, IDLE_STATE);
    },
    clearThread: (threadId) => {
      const currentState = states.get(threadId) ?? IDLE_STATE;
      if (currentState.status === "idle") {
        return;
      }
      updateState(threadId, IDLE_STATE);
    },
    isAgentControlled: ({ threadId, tabId }) => {
      const currentState = states.get(threadId) ?? IDLE_STATE;
      return currentState.status === "agent" && currentState.tabId === tabId;
    },
  };
}
