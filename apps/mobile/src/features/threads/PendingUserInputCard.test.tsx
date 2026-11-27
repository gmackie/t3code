import type { EnvironmentId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import type { PendingUserInput } from "../../lib/threadActivity";

const harness = vi.hoisted(() => ({
  navigate: [] as Array<[string, object | undefined]>,
  openedUrls: [] as string[],
}));

type Children = { children?: ReactNode };

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Keyboard: { dismiss: () => {} },
  View: ({ children }: Children) => <div>{children}</div>,
  ScrollView: ({ children }: Children) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: Children & { onPress?: () => void; accessibilityLabel?: string }) => (
    <div aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </div>
  ),
}));
vi.mock("react-native-reanimated", () => {
  const animation = { duration: () => ({ easing: () => ({}) }) };
  return {
    default: { View: ({ children }: Children) => <div>{children}</div> },
    Easing: { out: () => () => 0, cubic: () => 0 },
    FadeInUp: animation,
    FadeOutDown: animation,
    useAnimatedStyle: () => ({}),
    useAnimatedReaction: () => {},
    useDerivedValue: (derive: () => number) => ({ value: derive() }),
    useSharedValue: (value: number) => ({ value, set: () => {} }),
  };
});
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: Children) => <span>{children}</span>,
}));
vi.mock("../../components/ui/ControlPill", () => ({
  ControlPill: (props: { accessibilityLabel: string; onPress: () => void }) => (
    <button type="button" aria-label={props.accessibilityLabel} onClick={props.onPress} />
  ),
}));
vi.mock("react-native-keyboard-controller", () => ({
  useReanimatedKeyboardAnimation: () => ({ height: { value: 0 } }),
}));
vi.mock("../../state/preferences", async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  return {
    mobilePreferencesAtom: Atom.make(AsyncResult.success({ questionNavigationEnabled: true })),
  };
});
vi.mock("../../components/ui/Button", () => ({ Button: () => null }));
vi.mock("./QuestionAttachments", () => ({ QuestionAttachments: () => null }));
vi.mock("../files/FileMarkdownPreview", () => ({
  useMarkdownPreviewStyles: () => ({ nativeTextStyle: {} }),
}));
vi.mock("../../native/SelectableMarkdownText", () => ({
  SelectableMarkdownText: (props: { markdown: string; onLinkPress?: (href: string) => void }) => (
    <p>
      {[...props.markdown.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map(([, label, href]) => (
        <button key={href} type="button" onClick={() => props.onLinkPress?.(href!)}>
          {label}
        </button>
      ))}
    </p>
  ),
}));
vi.mock("../../state/entities", () => ({
  useLiveThreadLinkLabels: (markdown: string) => markdown,
}));
vi.mock("../../native/useOpenPullRequest", () => ({
  useOpenPullRequest: () => async (url: string) => {
    harness.openedUrls.push(url);
    return true;
  },
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: (name: string, params?: object) => harness.navigate.push([name, params]),
  }),
}));

import { PendingUserInputCard, usePendingUserInputPresentation } from "./PendingUserInputCard";

function setup(questionMarkdown: string) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.navigate = [];
  harness.openedUrls = [];

  const pendingUserInput = {
    requestId: "request-1" as RuntimeRequestId,
    responseCapability: "resumable",
    questions: [
      {
        id: "question-1",
        header: "Review",
        question: questionMarkdown,
        options: [],
        allowCustomAnswer: false,
      },
    ],
  } as unknown as PendingUserInput;
  const container = document.createElement("div");
  const root = createRoot(container);
  function InputArea({ environmentId }: { environmentId: string }) {
    const question = usePendingUserInputPresentation(
      environmentId + ":thread-1",
      pendingUserInput.requestId,
    );
    return (
      <>
        <input aria-label="Draft" hidden={question.replacesComposer} />
        <PendingUserInputCard
          environmentId={environmentId as EnvironmentId}
          threadId={"thread-1" as ThreadId}
          workspaceRoot="/repo"
          canOperateThread
          pendingUserInput={pendingUserInput}
          maxHeight={{ value: 600 } as never}
          cardProgress={{ value: 1, set: () => {} } as never}
          cardCoverage={{ value: 0, set: () => {} } as never}
          collapsed={question.collapsed}
          onToggleCollapsed={question.toggleCollapsed}
          drafts={{}}
          answers={null}
          respondingUserInputId={null}
          onSelectOption={() => {}}
          onChangeCustomAnswer={() => {}}
          onSubmit={async () => {}}
          onDismiss={async () => {}}
        />
      </>
    );
  }
  const render = (environmentId: string) =>
    act(() => root.render(<InputArea environmentId={environmentId} />));
  render("env-1");
  return {
    render,
    draft: container.querySelector("input")!,
    press(label: string) {
      const element = Array.from(container.querySelectorAll<HTMLElement>("[aria-label]")).find(
        (entry) => entry.ariaLabel === label,
      );
      if (!element) throw new Error("Missing action " + label);
      act(() => element.click());
    },
    async pressLink(label: string) {
      const link = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === label,
      );
      if (!link) throw new Error(`No link labelled ${label}`);
      await act(async () => link.click());
    },
    [Symbol.dispose]() {
      act(() => root.unmount());
    },
  };
}

it("opens a workspace file link in a question in the thread's file viewer", async () => {
  using screen = setup("Should I update [probe.md](docs/probe.md:12)?");

  await screen.pressLink("probe.md");

  expect(harness.openedUrls).toEqual([]);
  expect(harness.navigate).toEqual([
    [
      "ThreadFile",
      { environmentId: "env-1", threadId: "thread-1", path: ["docs", "probe.md"], line: "12" },
    ],
  ]);
});

it("can return to a draft without answering, and a different environment opens its own question", () => {
  using screen = setup("What should change?");
  expect(screen.draft.hidden).toBe(true);
  screen.press("Collapse user input");
  expect(screen.draft.hidden).toBe(false);
  screen.draft.value = "Keep this follow-up";
  screen.press("Expand user input, 1 question");
  expect(screen.draft.hidden).toBe(true);
  screen.press("Collapse user input");
  expect(screen.draft.value).toBe("Keep this follow-up");
  screen.render("env-2");
  expect(screen.draft.hidden).toBe(true);
});
