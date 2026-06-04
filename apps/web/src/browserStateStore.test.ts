import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { createBrowserTab } from "./browser";
import { selectThreadBrowserState, useBrowserStateStore } from "./browserStateStore";

const THREAD_ID = "thread-1" as ThreadId;

describe("browserStateStore actions", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.clear();
    }
    useBrowserStateStore.setState({ browserStateByThreadId: {} });
  });

  it("returns an empty default state for unknown threads", () => {
    const browserState = selectThreadBrowserState(
      useBrowserStateStore.getState().browserStateByThreadId,
      THREAD_ID,
    );
    expect(browserState).toEqual({
      activeTabId: null,
      tabs: [],
      inputValue: "",
      focusRequestId: 0,
      automationState: undefined,
    });
  });

  it("does not rewrite state for no-op updates", () => {
    const tab = { ...createBrowserTab("http://localhost:3000"), id: "tab-1" };
    useBrowserStateStore.setState({
      browserStateByThreadId: {
        [THREAD_ID]: {
          activeTabId: tab.id,
          tabs: [tab],
          inputValue: tab.url,
          focusRequestId: 0,
          automationState: undefined,
        },
      },
    });

    const beforeMap = useBrowserStateStore.getState().browserStateByThreadId;
    const beforeEntry = beforeMap[THREAD_ID];
    useBrowserStateStore.getState().updateThreadBrowserState(THREAD_ID, (state) => state);
    const afterMap = useBrowserStateStore.getState().browserStateByThreadId;
    const afterEntry = afterMap[THREAD_ID];

    expect(afterMap).toBe(beforeMap);
    expect(afterEntry).toBe(beforeEntry);
    expect(afterEntry?.tabs).toBe(beforeEntry?.tabs);
  });

  it("drops malformed persisted tabs without throwing", () => {
    expect(() => {
      useBrowserStateStore.getState().updateThreadBrowserState(THREAD_ID, () => ({
        activeTabId: "bad-tab",
        tabs: [
          { id: null, url: "http://localhost:3000" } as unknown as ReturnType<
            typeof createBrowserTab
          >,
        ],
        inputValue: "",
        focusRequestId: 0,
        automationState: undefined,
      }));
    }).not.toThrow();

    const browserState = selectThreadBrowserState(
      useBrowserStateStore.getState().browserStateByThreadId,
      THREAD_ID,
    );

    expect(browserState).toEqual({
      activeTabId: null,
      tabs: [],
      inputValue: "",
      focusRequestId: 0,
      automationState: undefined,
    });
  });

  it("keeps multiple browser tabs for a thread and preserves the latest active tab", () => {
    const first = { ...createBrowserTab("https://example.com"), id: "browser-1" };
    const second = { ...createBrowserTab("https://openai.com"), id: "browser-2" };

    useBrowserStateStore.getState().updateThreadBrowserState(THREAD_ID, () => ({
      activeTabId: second.id,
      tabs: [first, second],
      inputValue: second.url,
      focusRequestId: 2,
      automationState: undefined,
    }));

    const browserState = selectThreadBrowserState(
      useBrowserStateStore.getState().browserStateByThreadId,
      THREAD_ID,
    );
    expect(browserState.activeTabId).toBe(second.id);
    expect(browserState.tabs.map((tab) => tab.id)).toEqual([first.id, second.id]);
    expect(browserState.inputValue).toBe("https://openai.com");
  });
});
