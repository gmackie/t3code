import { WebContentsView, type BrowserWindow, type Rectangle } from "electron";
import type {
  BrowserAutomationTarget,
  BrowserClearThreadInput,
  BrowserEnsureTabInput,
  BrowserEvent,
  BrowserNavigateInput,
  BrowserSyncHostInput,
  BrowserTabRuntimeState,
  BrowserTabTargetInput,
  ThreadId,
} from "@t3tools/contracts";

import { createBrowserAutomationControl } from "./browserAutomationControl";

const ERR_ABORTED = -3;
const MAX_LIVE_BROWSER_TABS = 3;

type BrowserTabRecord = {
  key: string;
  threadId: ThreadId;
  tabId: string;
  view: WebContentsView | null;
  state: BrowserTabRuntimeState;
  lastAccessedAt: number;
  consoleMessages: string[];
  networkErrors: string[];
};

export interface BrowserManager {
  ensureTab: (input: BrowserEnsureTabInput) => Promise<void>;
  claimAutomationControl: (input: BrowserTabTargetInput & { message: string }) => void;
  navigate: (input: BrowserNavigateInput) => Promise<void>;
  click: (input: BrowserTabTargetInput & { target: BrowserAutomationTarget }) => Promise<void>;
  typeText: (
    input: BrowserTabTargetInput & {
      target: BrowserAutomationTarget;
      text: string;
      submit?: boolean;
      clear?: boolean;
    },
  ) => Promise<void>;
  wait: (
    input: BrowserTabTargetInput & {
      selector?: string;
      text?: string;
      urlIncludes?: string;
      titleIncludes?: string;
      timeoutMs?: number;
    },
  ) => Promise<void>;
  inspect: (input: BrowserTabTargetInput) => Promise<{
    url: string;
    title: string | null;
    text: string;
  }>;
  screenshot: (input: BrowserTabTargetInput) => Promise<string>;
  diagnostics: (input: BrowserTabTargetInput) => Promise<{
    url: string;
    title: string | null;
    consoleMessages: string[];
    networkErrors: string[];
  }>;
  goBack: (input: BrowserTabTargetInput) => Promise<void>;
  goForward: (input: BrowserTabTargetInput) => Promise<void>;
  reload: (input: BrowserTabTargetInput) => Promise<void>;
  closeTab: (input: BrowserTabTargetInput) => Promise<void>;
  syncHost: (input: BrowserSyncHostInput) => void;
  clearThread: (input: BrowserClearThreadInput) => void;
  destroyAll: () => void;
}

interface BrowserManagerOptions {
  emitEvent: (event: BrowserEvent) => void;
  getWindow: () => BrowserWindow | null;
  openExternal: (url: string) => void | Promise<void>;
}

function recordKey(threadId: ThreadId, tabId: string): string {
  return `${threadId}\u0000${tabId}`;
}

function normalizeRuntimeUrl(url: string | null | undefined): string {
  if (!url || url.trim().length === 0) {
    return "about:blank";
  }
  return url;
}

function readBrowserTitle(view: WebContentsView, fallback: string | null): string | null {
  const title = view.webContents.getTitle().trim();
  if (title.length > 0) {
    return title;
  }
  return fallback;
}

function now(): number {
  return Date.now();
}

function appendBounded(target: string[], value: string): void {
  target.push(value);
  if (target.length > 100) {
    target.shift();
  }
}

const BROWSER_TARGET_HELPERS_SOURCE = String.raw`
  const normalizeTargetText = (value) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim().toLowerCase() : "";
  const readVisibleText = (element) =>
    normalizeTargetText(
      "innerText" in element && typeof element.innerText === "string"
        ? element.innerText
        : (element.textContent ?? ""),
    );
  const readElementRole = (element) => {
    const explicitRole = normalizeTargetText(element.getAttribute("role"));
    if (explicitRole) return explicitRole;
    const tagName = element.tagName.toLowerCase();
    if (tagName === "button") return "button";
    if (tagName === "a" && element.hasAttribute("href")) return "link";
    if (tagName === "textarea") return "textbox";
    if (tagName === "select") return "combobox";
    if (tagName !== "input") return "";
    const type = normalizeTargetText(element.getAttribute("type")) || "text";
    if (type === "button" || type === "submit" || type === "reset") return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    return "textbox";
  };
  const readLabeledText = (element) => {
    if ("labels" in element && Array.isArray(element.labels)) {
      return normalizeTargetText(element.labels.map((label) => label.textContent ?? "").join(" "));
    }
    if ("labels" in element && element.labels) {
      return normalizeTargetText(Array.from(element.labels).map((label) => label.textContent ?? "").join(" "));
    }
    return "";
  };
  const readAccessibleName = (element) => {
    const ariaLabel = normalizeTargetText(element.getAttribute("aria-label"));
    if (ariaLabel) return ariaLabel;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      const normalized = normalizeTargetText(text);
      if (normalized) return normalized;
    }
    const labeledText = readLabeledText(element);
    if (labeledText) return labeledText;
    const placeholder = normalizeTargetText(element.getAttribute("placeholder"));
    if (placeholder) return placeholder;
    const title = normalizeTargetText(element.getAttribute("title"));
    if (title) return title;
    return readVisibleText(element);
  };
  const isElementVisible = (element) => {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
      return false;
    }
    return element.getClientRects().length > 0;
  };
  const isEditableElement = (element) =>
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable);
  const describeTarget = (target) => {
    if (normalizeTargetText(target?.selector)) {
      return "selector " + String(target.selector);
    }
    const role = normalizeTargetText(target?.role);
    const name = normalizeTargetText(target?.name);
    const text = normalizeTargetText(target?.text);
    const parts = [];
    if (role) parts.push(role);
    if (name) parts.push('"' + String(target.name).trim() + '"');
    if (!name && text) parts.push('text "' + String(target.text).trim() + '"');
    if (typeof target?.index === "number" && Number.isFinite(target.index) && target.index > 0) {
      parts.push("#" + String(target.index));
    }
    return parts.length > 0 ? parts.join(" ") : "target";
  };
  const resolveTarget = (target, options) => {
    const matchIndex =
      typeof target?.index === "number" && Number.isFinite(target.index) && target.index >= 0
        ? Math.floor(target.index)
        : 0;
    const selector = normalizeTargetText(target?.selector);
    let candidates = [];
    if (selector) {
      candidates = Array.from(document.querySelectorAll(String(target.selector))).filter(
        (element) => element instanceof HTMLElement,
      );
    } else {
      candidates = Array.from(document.querySelectorAll("body *")).filter(
        (element) => element instanceof HTMLElement && isElementVisible(element),
      );
      const role = normalizeTargetText(target?.role);
      const name = normalizeTargetText(target?.name);
      const text = normalizeTargetText(target?.text);
      if (role) {
        candidates = candidates.filter((element) => readElementRole(element) === role);
      }
      if (name) {
        candidates = candidates.filter((element) => readAccessibleName(element).includes(name));
      }
      if (text) {
        candidates = candidates.filter((element) => readVisibleText(element).includes(text));
      }
    }
    if (options?.editableOnly) {
      candidates = candidates.filter((element) => isEditableElement(element));
    }
    const element = candidates[matchIndex];
    if (!(element instanceof HTMLElement)) {
      throw new Error("Element not found for " + describeTarget(target));
    }
    return element;
  };
`;

function statesEqual(left: BrowserTabRuntimeState, right: BrowserTabRuntimeState): boolean {
  return (
    left.url === right.url &&
    left.title === right.title &&
    left.faviconUrl === right.faviconUrl &&
    left.isLoading === right.isLoading &&
    left.canGoBack === right.canGoBack &&
    left.canGoForward === right.canGoForward &&
    left.lastError === right.lastError
  );
}

function sanitizeBounds(bounds: BrowserSyncHostInput["bounds"]): Rectangle | null {
  if (!bounds) {
    return null;
  }
  const x = Number.isFinite(bounds.x) ? Math.max(0, Math.round(bounds.x)) : null;
  const y = Number.isFinite(bounds.y) ? Math.max(0, Math.round(bounds.y)) : null;
  const width = Number.isFinite(bounds.width) ? Math.max(0, Math.round(bounds.width)) : null;
  const height = Number.isFinite(bounds.height) ? Math.max(0, Math.round(bounds.height)) : null;
  if (
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    width === 0 ||
    height === 0
  ) {
    return null;
  }
  return { x, y, width, height };
}

export function createBrowserManager(options: BrowserManagerOptions): BrowserManager {
  const records = new Map<string, BrowserTabRecord>();
  const automationControl = createBrowserAutomationControl(options.emitEvent);
  let activeHost: BrowserSyncHostInput | null = null;
  let attachedRecordKey: string | null = null;

  const emitState = (
    record: BrowserTabRecord,
    patch: Partial<BrowserTabRuntimeState> = {},
    emitOptions: { preferBlankTitle?: boolean } = {},
  ): void => {
    const runtimeUrl = record.view
      ? normalizeRuntimeUrl(record.view.webContents.getURL())
      : normalizeRuntimeUrl(record.state.url);
    const fallbackTitle =
      emitOptions.preferBlankTitle || runtimeUrl === "about:blank" ? null : record.state.title;
    const nextState: BrowserTabRuntimeState = {
      url: patch.url ?? runtimeUrl ?? record.state.url,
      title:
        patch.title !== undefined
          ? patch.title
          : record.view
            ? readBrowserTitle(record.view, fallbackTitle ?? record.state.title)
            : (fallbackTitle ?? record.state.title),
      faviconUrl:
        patch.faviconUrl !== undefined ? patch.faviconUrl : (record.state.faviconUrl ?? null),
      isLoading: patch.isLoading ?? (record.view ? record.view.webContents.isLoading() : false),
      canGoBack: patch.canGoBack ?? (record.view ? record.view.webContents.canGoBack() : false),
      canGoForward:
        patch.canGoForward ?? (record.view ? record.view.webContents.canGoForward() : false),
      lastError: patch.lastError !== undefined ? patch.lastError : record.state.lastError,
    };
    if (nextState.url === "about:blank" && nextState.title === "") {
      nextState.title = null;
    }
    if (statesEqual(record.state, nextState)) {
      return;
    }
    record.state = nextState;
    options.emitEvent({
      type: "tab-state",
      threadId: record.threadId,
      tabId: record.tabId,
      state: nextState,
    });
  };

  const touchRecord = (record: BrowserTabRecord): void => {
    record.lastAccessedAt = now();
  };

  const detachRecord = (record: BrowserTabRecord | null): void => {
    if (!record?.view) {
      return;
    }
    record.view.setVisible(false);
    const window = options.getWindow();
    if (!window) {
      return;
    }
    if (window.contentView.children.includes(record.view)) {
      window.contentView.removeChildView(record.view);
    }
  };

  const disposeRecordView = (record: BrowserTabRecord): void => {
    const view = record.view;
    if (!view) {
      return;
    }
    if (attachedRecordKey === record.key) {
      detachRecord(record);
      attachedRecordKey = null;
    } else {
      view.setVisible(false);
      const window = options.getWindow();
      if (window && window.contentView.children.includes(view)) {
        window.contentView.removeChildView(view);
      }
    }
    record.view = null;
    if (!view.webContents.isDestroyed()) {
      view.webContents.close({ waitForBeforeUnload: false });
    }
    emitState(record, {
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
    });
  };

  const enforceLiveTabBudget = (protectedRecordKey: string | null): void => {
    const liveRecords = [...records.values()].filter((record) => record.view !== null);
    if (liveRecords.length <= MAX_LIVE_BROWSER_TABS) {
      return;
    }
    const protectedKeys = new Set<string>();
    if (protectedRecordKey) {
      protectedKeys.add(protectedRecordKey);
    }
    if (activeHost?.visible && activeHost.tabId) {
      protectedKeys.add(recordKey(activeHost.threadId, activeHost.tabId));
    }
    const evictionCandidates = liveRecords
      .filter((record) => !protectedKeys.has(record.key))
      .toSorted((left, right) => left.lastAccessedAt - right.lastAccessedAt);

    while (liveRecords.filter((record) => record.view !== null).length > MAX_LIVE_BROWSER_TABS) {
      const nextCandidate = evictionCandidates.shift();
      if (!nextCandidate) {
        break;
      }
      disposeRecordView(nextCandidate);
    }
  };

  const wireRecordEvents = (record: BrowserTabRecord, view: WebContentsView): void => {
    const { webContents } = view;
    const isCurrentView = () => record.view === view;
    const markUserControlIfNeeded = () => {
      if (
        attachedRecordKey !== record.key ||
        !activeHost?.visible ||
        !automationControl.isAgentControlled({
          threadId: record.threadId,
          tabId: record.tabId,
        })
      ) {
        return;
      }
      automationControl.markUserControl({
        threadId: record.threadId,
        tabId: record.tabId,
        message: "User took over browser control",
      });
    };
    const emitIfCurrent = (
      patch: Partial<BrowserTabRuntimeState> = {},
      emitOptions: { preferBlankTitle?: boolean } = {},
    ) => {
      if (!isCurrentView()) {
        return;
      }
      touchRecord(record);
      emitState(record, patch, emitOptions);
    };

    webContents.setWindowOpenHandler(({ url }) => {
      void options.openExternal(url);
      return { action: "deny" };
    });
    webContents.on("did-start-loading", () => {
      emitIfCurrent({ isLoading: true, lastError: null });
    });
    webContents.on("did-stop-loading", () => {
      emitIfCurrent({ isLoading: false });
    });
    webContents.on("did-navigate", (_event, url) => {
      emitIfCurrent({ url: normalizeRuntimeUrl(url), lastError: null }, { preferBlankTitle: true });
    });
    webContents.on("did-navigate-in-page", (_event, url) => {
      emitIfCurrent({ url: normalizeRuntimeUrl(url), lastError: null }, { preferBlankTitle: true });
    });
    webContents.on("page-title-updated", (event, title) => {
      event.preventDefault();
      emitIfCurrent({ title: title.trim().length > 0 ? title : null });
    });
    webContents.on("page-favicon-updated", (_event, favicons) => {
      emitIfCurrent({ faviconUrl: favicons[0] ?? null });
    });
    webContents.on("console-message", (_event, _level, message) => {
      if (!isCurrentView()) {
        return;
      }
      appendBounded(record.consoleMessages, message);
    });
    webContents.on("before-input-event", () => {
      if (!isCurrentView()) {
        return;
      }
      markUserControlIfNeeded();
    });
    webContents.on("before-mouse-event", (_event, input) => {
      if (!isCurrentView()) {
        return;
      }
      if (input.type !== "mouseDown" && input.type !== "mouseUp" && input.type !== "mouseWheel") {
        return;
      }
      markUserControlIfNeeded();
    });
    webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === ERR_ABORTED) {
          return;
        }
        appendBounded(
          record.networkErrors,
          `${validatedURL || record.state.url}: ${errorDescription || "Failed to load page."}`,
        );
        emitIfCurrent({
          url: normalizeRuntimeUrl(validatedURL),
          isLoading: false,
          lastError: errorDescription || "Failed to load page.",
        });
      },
    );
    webContents.on("render-process-gone", (_event, details) => {
      emitIfCurrent({
        isLoading: false,
        lastError: `Browser tab crashed (${details.reason}).`,
      });
    });
    webContents.once("destroyed", () => {
      if (!isCurrentView()) {
        return;
      }
      if (attachedRecordKey === record.key) {
        attachedRecordKey = null;
      }
      record.view = null;
      emitState(record, {
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
      });
      syncAttachedView();
    });
  };

  const createLiveViewForRecord = (
    record: BrowserTabRecord,
    options: { restoreFromState?: boolean } = {},
  ): WebContentsView => {
    if (record.view) {
      touchRecord(record);
      return record.view;
    }
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    view.setVisible(false);
    record.view = view;
    touchRecord(record);
    wireRecordEvents(record, view);
    if (options.restoreFromState && record.state.url !== "about:blank") {
      void loadRecordUrl(record, record.state.url);
    }
    enforceLiveTabBudget(record.key);
    return view;
  };

  const syncAttachedView = (): void => {
    const window = options.getWindow();
    const desiredRecord =
      activeHost && activeHost.visible && activeHost.tabId && sanitizeBounds(activeHost.bounds)
        ? (records.get(recordKey(activeHost.threadId, activeHost.tabId)) ?? null)
        : null;
    const attachedRecord = attachedRecordKey ? (records.get(attachedRecordKey) ?? null) : null;
    if (attachedRecord && (!window || !desiredRecord || desiredRecord.key !== attachedRecord.key)) {
      detachRecord(attachedRecord);
      attachedRecordKey = null;
    }
    if (!window || !desiredRecord || !activeHost) {
      return;
    }
    const bounds = sanitizeBounds(activeHost.bounds);
    if (!bounds) {
      detachRecord(desiredRecord);
      attachedRecordKey = null;
      return;
    }
    createLiveViewForRecord(desiredRecord, { restoreFromState: true });
    touchRecord(desiredRecord);
    if (!desiredRecord.view) {
      return;
    }
    desiredRecord.view.setBounds(bounds);
    desiredRecord.view.setVisible(true);
    window.contentView.addChildView(desiredRecord.view);
    attachedRecordKey = desiredRecord.key;
  };

  const destroyRecord = (record: BrowserTabRecord): void => {
    disposeRecordView(record);
    records.delete(record.key);
    syncAttachedView();
  };

  const createRecord = (input: BrowserEnsureTabInput): BrowserTabRecord => {
    const key = recordKey(input.threadId, input.tabId);
    const record: BrowserTabRecord = {
      key,
      threadId: input.threadId,
      tabId: input.tabId,
      view: null,
      state: {
        url: normalizeRuntimeUrl(input.url),
        title: null,
        faviconUrl: null,
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        lastError: null,
      },
      lastAccessedAt: now(),
      consoleMessages: [],
      networkErrors: [],
    };
    records.set(key, record);
    emitState(record, { url: normalizeRuntimeUrl(input.url) }, { preferBlankTitle: true });
    return record;
  };

  const ensureRecord = (input: BrowserTabTargetInput): BrowserTabRecord => {
    return records.get(recordKey(input.threadId, input.tabId)) ?? createRecord(input);
  };

  const ensureLiveRecord = (input: BrowserTabTargetInput): BrowserTabRecord => {
    const record = ensureRecord(input);
    createLiveViewForRecord(record, { restoreFromState: true });
    touchRecord(record);
    return record;
  };

  const executeRecordScript = async <T>(
    record: BrowserTabRecord,
    script: string,
    args: unknown,
  ): Promise<T> => {
    if (!record.view) {
      createLiveViewForRecord(record, { restoreFromState: true });
    }
    if (!record.view) {
      throw new Error("Browser tab is unavailable.");
    }
    return (await record.view.webContents.executeJavaScript(
      `(${script})(${JSON.stringify(args)})`,
    )) as T;
  };

  const loadRecordUrl = async (record: BrowserTabRecord, url: string): Promise<void> => {
    createLiveViewForRecord(record);
    emitState(
      record,
      {
        url,
        title: url === "about:blank" ? null : record.state.title,
        faviconUrl: url === "about:blank" ? null : record.state.faviconUrl,
        isLoading: url !== "about:blank",
        lastError: null,
      },
      { preferBlankTitle: url === "about:blank" },
    );
    try {
      if (!record.view) {
        return;
      }
      await record.view.webContents.loadURL(url);
    } catch (error) {
      if (!record.view || record.view.webContents.isDestroyed()) {
        return;
      }
      emitState(record, {
        url,
        isLoading: false,
        lastError: error instanceof Error ? error.message : "Failed to load page.",
      });
    }
  };

  const ensureTab = async (input: BrowserEnsureTabInput): Promise<void> => {
    const key = recordKey(input.threadId, input.tabId);
    const existing = records.get(key);
    if (existing) {
      return;
    }
    createRecord(input);
    syncAttachedView();
  };

  return {
    ensureTab,
    claimAutomationControl: (input) => {
      automationControl.claimAgentControl(input);
    },
    navigate: async (input) => {
      await ensureTab(input);
      const record = records.get(recordKey(input.threadId, input.tabId));
      if (!record) {
        return;
      }
      await loadRecordUrl(record, input.url);
      syncAttachedView();
    },
    click: async (input) => {
      const record = ensureLiveRecord(input);
      await executeRecordScript<void>(
        record,
        `({ target }) => {
          ${BROWSER_TARGET_HELPERS_SOURCE}
          const element = resolveTarget(target, { editableOnly: false });
          element.scrollIntoView({ block: "center", inline: "center" });
          element.click();
        }`,
        { target: input.target },
      );
    },
    typeText: async (input) => {
      const record = ensureLiveRecord(input);
      await executeRecordScript<void>(
        record,
        `({ target, text, submit, clear }) => {
          ${BROWSER_TARGET_HELPERS_SOURCE}
          const element = resolveTarget(target, { editableOnly: true });
          element.scrollIntoView({ block: "center", inline: "center" });
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const descriptor = Object.getOwnPropertyDescriptor(
              Object.getPrototypeOf(element),
              "value",
            );
            const nextValue = clear ? text : \`\${element.value ?? ""}\${text}\`;
            descriptor?.set?.call(element, nextValue);
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            const nextValue = clear ? text : \`\${element.textContent ?? ""}\${text}\`;
            element.textContent = nextValue;
            element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
          }

          if (submit) {
            const form = element instanceof HTMLElement ? element.closest("form") : null;
            if (form instanceof HTMLFormElement) {
              form.requestSubmit();
            }
          }
        }`,
        {
          target: input.target,
          text: input.text,
          submit: input.submit ?? false,
          clear: input.clear ?? true,
        },
      );
    },
    wait: async (input) => {
      const record = ensureLiveRecord(input);
      const matched = await executeRecordScript<boolean>(
        record,
        `({ selector, text, urlIncludes, titleIncludes, timeoutMs }) => {
          const deadline = Date.now() + timeoutMs;
          return new Promise((resolve) => {
            const tick = () => {
              const selectorMatched = selector ? document.querySelector(selector) !== null : false;
              const textMatched =
                text && document.body ? document.body.innerText.includes(text) : false;
              const urlMatched = urlIncludes
                ? window.location.href.includes(urlIncludes)
                : false;
              const titleMatched = titleIncludes
                ? document.title.includes(titleIncludes)
                : false;
              const noPredicate = !selector && !text && !urlIncludes && !titleIncludes;
              if (selectorMatched || textMatched || urlMatched || titleMatched || noPredicate) {
                resolve(true);
                return;
              }
              if (Date.now() >= deadline) {
                resolve(false);
                return;
              }
              window.setTimeout(tick, 100);
            };
            tick();
          });
        }`,
        {
          selector: input.selector,
          text: input.text,
          urlIncludes: input.urlIncludes,
          titleIncludes: input.titleIncludes,
          timeoutMs: Math.max(100, input.timeoutMs ?? 10_000),
        },
      );
      if (!matched) {
        throw new Error("Timed out waiting for page state.");
      }
    },
    inspect: async (input) => {
      const record = ensureLiveRecord(input);
      return await executeRecordScript<{ url: string; title: string | null; text: string }>(
        record,
        `() => {
          const text = document.body?.innerText?.replace(/\\s+/g, " ").trim() ?? "";
          return {
            url: window.location.href,
            title: document.title || null,
            text: text.slice(0, 4000),
          };
        }`,
        {},
      );
    },
    screenshot: async (input) => {
      const record = ensureLiveRecord(input);
      if (!record.view) {
        throw new Error("Browser tab is unavailable.");
      }
      const image = await record.view.webContents.capturePage();
      return image.toDataURL();
    },
    diagnostics: async (input) => {
      const record = ensureLiveRecord(input);
      return {
        url: record.view?.webContents.getURL() || record.state.url,
        title: record.view ? readBrowserTitle(record.view, record.state.title) : record.state.title,
        consoleMessages: [...record.consoleMessages],
        networkErrors: [...record.networkErrors],
      };
    },
    goBack: async (input) => {
      const record = records.get(recordKey(input.threadId, input.tabId));
      if (!record?.view || !record.view.webContents.canGoBack()) {
        return;
      }
      touchRecord(record);
      record.view.webContents.goBack();
    },
    goForward: async (input) => {
      const record = records.get(recordKey(input.threadId, input.tabId));
      if (!record?.view || !record.view.webContents.canGoForward()) {
        return;
      }
      touchRecord(record);
      record.view.webContents.goForward();
    },
    reload: async (input) => {
      const record = records.get(recordKey(input.threadId, input.tabId));
      if (!record) {
        return;
      }
      if (!record.view) {
        await loadRecordUrl(record, record.state.url);
        syncAttachedView();
        return;
      }
      touchRecord(record);
      record.view.webContents.reload();
    },
    closeTab: async (input) => {
      const record = records.get(recordKey(input.threadId, input.tabId));
      if (!record) {
        return;
      }
      destroyRecord(record);
    },
    syncHost: (input) => {
      if (!input.visible) {
        automationControl.releaseUserControl({
          threadId: input.threadId,
          tabId: input.tabId ?? activeHost?.tabId ?? "",
        });
      }
      activeHost = input;
      syncAttachedView();
    },
    clearThread: (input) => {
      const toDestroy = [...records.values()].filter(
        (record) => record.threadId === input.threadId,
      );
      for (const record of toDestroy) {
        destroyRecord(record);
      }
      if (activeHost?.threadId === input.threadId) {
        activeHost = {
          threadId: input.threadId,
          tabId: null,
          visible: false,
          bounds: null,
        };
      }
      automationControl.clearThread(input.threadId);
      syncAttachedView();
    },
    destroyAll: () => {
      activeHost = null;
      const allRecords = [...records.values()];
      for (const record of allRecords) {
        automationControl.clearThread(record.threadId);
        destroyRecord(record);
      }
    },
  };
}
