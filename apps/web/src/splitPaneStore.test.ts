import { beforeEach, describe, expect, it } from "vitest";

import { useSplitPaneStore } from "./splitPaneStore";

describe("splitPaneStore", () => {
  beforeEach(() => {
    useSplitPaneStore.setState({
      secondaryThreadRef: null,
      focusedPane: "primary",
      splitRatio: 0.5,
    });
  });

  it("stores and clears the secondary thread pane target", () => {
    const threadRef = {
      environmentId: "environment-local" as never,
      threadId: "thread-secondary" as never,
    };

    useSplitPaneStore.getState().setSecondaryThreadRef(threadRef);
    expect(useSplitPaneStore.getState().secondaryThreadRef).toEqual(threadRef);
    expect(useSplitPaneStore.getState().focusedPane).toBe("secondary");

    useSplitPaneStore.getState().clearSecondaryThreadRef();
    expect(useSplitPaneStore.getState().secondaryThreadRef).toBeNull();
    expect(useSplitPaneStore.getState().focusedPane).toBe("primary");
  });

  it("treats identical secondary targets as a no-op", () => {
    const threadRef = {
      environmentId: "environment-local" as never,
      threadId: "thread-secondary" as never,
    };

    useSplitPaneStore.getState().setSecondaryThreadRef(threadRef);
    const previous = useSplitPaneStore.getState().secondaryThreadRef;
    useSplitPaneStore.getState().setSecondaryThreadRef({
      environmentId: "environment-local" as never,
      threadId: "thread-secondary" as never,
    });

    expect(useSplitPaneStore.getState().secondaryThreadRef).toBe(previous);
  });

  it("tracks pane focus separately when a secondary pane exists", () => {
    const threadRef = {
      environmentId: "environment-local" as never,
      threadId: "thread-secondary" as never,
    };

    useSplitPaneStore.getState().setSecondaryThreadRef(threadRef);
    useSplitPaneStore.getState().focusPane("primary");
    expect(useSplitPaneStore.getState().focusedPane).toBe("primary");

    useSplitPaneStore.getState().focusPane("secondary");
    expect(useSplitPaneStore.getState().focusedPane).toBe("secondary");
  });

  it("clamps split ratios into the supported resize range", () => {
    useSplitPaneStore.getState().setSplitRatio(0.05);
    expect(useSplitPaneStore.getState().splitRatio).toBe(0.2);

    useSplitPaneStore.getState().setSplitRatio(0.72);
    expect(useSplitPaneStore.getState().splitRatio).toBe(0.72);

    useSplitPaneStore.getState().setSplitRatio(0.95);
    expect(useSplitPaneStore.getState().splitRatio).toBe(0.8);
  });
});
