import { Button } from "../../components/ui/Button";
import { QuestionAttachments } from "./QuestionAttachments";
import type { EnvironmentId, RuntimeRequestId, ThreadId } from "@t3tools/contracts";
import type { ThreadUserInputQuestion } from "@t3tools/client-runtime/state/thread-requests";
import { useAtomValue } from "@effect/atom-react";
import {
  markdownProseDirection,
  textDirection,
  type TextDirection,
} from "@t3tools/shared/textDirection";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { Plural, T, useGT, Var } from "gt-react-native";
import Animated, {
  useAnimatedStyle,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  type DerivedValue,
  type SharedValue,
} from "react-native-reanimated";

import { derivePendingUserInputCompactHeight } from "./pendingUserInputLayout";

import { mobilePreferencesAtom } from "../../state/preferences";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { cn } from "../../lib/cn";
import { resolveMarkdownLinkPresentation } from "../../lib/markdownLinks";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { useOpenPullRequest } from "../../native/useOpenPullRequest";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import {
  fileRoutePathSegments,
  resolveFileLinkPath,
  resolveWorkspaceRelativeFilePath,
} from "../files/filePath";
import { useLiveThreadLinkLabels } from "../../state/entities";
import {
  isPendingUserInputOptionSelected,
  type PendingUserInputDraftAnswer,
} from "@t3tools/client-runtime/state/pending-user-input";
import type { PendingUserInput } from "../../lib/threadActivity";

export interface PendingUserInputCardProps {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string | null;
  readonly canOperateThread: boolean;
  readonly pendingUserInput: PendingUserInput;
  readonly maxHeight: DerivedValue<number>;
  readonly expandInPane: boolean;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  /** A stop control where the question owns the input area. */
  readonly onStopThread?: () => void;
  /** 0 collapsed → 1 expanded; the host animates it from the tap handler on the UI thread. */
  readonly cardProgress: SharedValue<number>;
  /** How far the expanded card extends above the bar; the host adds it to the feed's end inset. */
  readonly cardCoverage: SharedValue<number>;
  readonly onLayout?: (event: LayoutChangeEvent) => void;
  /** Fires on custom-answer focus/blur; hosts use it to vet stale keyboard state. */
  readonly onInputFocusChange?: (focused: boolean) => void;
  readonly drafts: Record<string, PendingUserInputDraftAnswer>;
  readonly answers: Record<string, string | ReadonlyArray<string>> | null;
  readonly respondingUserInputId: RuntimeRequestId | null;
  readonly onSelectOption: (
    requestId: RuntimeRequestId,
    question: ThreadUserInputQuestion,
    value: string,
  ) => void;
  readonly onChangeCustomAnswer: (
    requestId: RuntimeRequestId,
    questionId: string,
    customAnswer: string,
  ) => void;
  readonly onSubmit: () => Promise<unknown>;
  /** Closes an async question without a reply. Hidden for native callback questions. */
  readonly onDismiss: () => Promise<unknown>;
}

function proseDirectionStyle(text: string, setDirection: TextDirection | undefined) {
  const direction = textDirection(text);
  return {
    ...(direction ? { direction, writingDirection: direction } : null),
    textAlign: (direction === "rtl") === (setDirection === "rtl") ? "left" : "right",
  } as const;
}

function QuestionText(props: {
  readonly markdown: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly workspaceRoot: string | null;
  readonly setDirection: TextDirection | undefined;
  readonly preserveSoftBreaks?: boolean;
}) {
  const styles = useMarkdownPreviewStyles();
  const markdown = useLiveThreadLinkLabels(props.markdown, props.environmentId);
  const navigation = useNavigation();
  const openPullRequest = useOpenPullRequest();
  const openLink = (href: string) => {
    const link = resolveMarkdownLinkPresentation(href);
    if (link.kind !== "file") {
      void openPullRequest(href);
      return;
    }
    const path = resolveFileLinkPath(props.workspaceRoot, link.path);
    if (path === null) return;
    navigation.navigate("ThreadFile", {
      environmentId: String(props.environmentId),
      threadId: String(props.threadId),
      path: fileRoutePathSegments(
        resolveWorkspaceRelativeFilePath(props.workspaceRoot, path) ?? path,
      ),
      ...(link.line ? { line: String(link.line) } : {}),
    });
  };
  return (
    <SelectableMarkdownText
      markdown={markdown}
      textStyle={styles.nativeTextStyle}
      writingDirection={markdownProseDirection(markdown)}
      // Android's renderer aligns relative to each paragraph's direction.
      textAlign={
        Platform.OS === "android" ? undefined : props.setDirection === "rtl" ? "right" : "left"
      }
      onLinkPress={openLink}
      preserveSoftBreaks={props.preserveSoftBreaks}
    />
  );
}

/** The question and draft share one input area. A new request starts with the question open. */
export function usePendingUserInputPresentation(
  threadKey: string,
  requestId: RuntimeRequestId | null,
) {
  const [toggle, setToggle] = useState<{
    readonly threadKey: string;
    readonly requestId: RuntimeRequestId;
    readonly collapsed: boolean;
  } | null>(null);
  const toggled = toggle?.threadKey === threadKey && toggle.requestId === requestId;
  const collapsed = toggled && toggle.collapsed;
  const toggleCollapsed = () => {
    if (!requestId) return;
    Keyboard.dismiss();
    setToggle({ threadKey, requestId, collapsed: !collapsed });
  };
  return {
    collapsed,
    replacesComposer: requestId !== null && !collapsed,
    motion: !toggled ? "fresh" : collapsed ? "collapsed" : "expanded",
    toggleCollapsed,
  } as const;
}

export function PendingUserInputCard(props: PendingUserInputCardProps) {
  const gt = useGT();
  const questionCount = props.pendingUserInput.questions.length;
  // Message responses start a new run and remain available after the provider exits.
  const canRespond = props.pendingUserInput.responseCapability !== "not_resumable";
  const isResponding = props.respondingUserInputId === props.pendingUserInput.requestId;
  const responseDisabled = !canRespond || isResponding;
  const setDirection = markdownProseDirection(
    props.pendingUserInput.questions
      .flatMap((question) => [
        question.header,
        question.question,
        ...question.options.flatMap((option) => [option.label, option.description ?? ""]),
      ])
      .join(" "),
  );
  const [expanded, setExpanded] = useState(true);
  const showExpandedModal = expanded && !props.expandInPane;
  const focused = useIsFocused();
  const [questionIndex, setQuestionIndex] = useState(0);
  const activeQuestionIndex = Math.min(questionIndex, Math.max(0, questionCount - 1));
  const question = props.pendingUserInput.questions[activeQuestionIndex];
  const isLastQuestion = activeQuestionIndex === questionCount - 1;
  const preferences = useAtomValue(mobilePreferencesAtom);
  const paginated =
    !AsyncResult.isSuccess(preferences) || preferences.value.questionNavigationEnabled !== false;
  const showSubmit = !paginated || isLastQuestion;
  const visibleQuestions = paginated
    ? question
      ? [question]
      : []
    : props.pendingUserInput.questions;
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  // The host's maxHeight already excludes the open keyboard, on the UI thread.
  const maxHeight = props.maxHeight;
  const measuredCardHeight = useSharedValue(0);
  const lastKeyboardHeight = useSharedValue(0);
  useAnimatedReaction(
    () => Math.abs(keyboardHeight.value),
    (height) => {
      if (height > lastKeyboardHeight.value) lastKeyboardHeight.set(height);
    },
  );
  // Compact keeps one size whether or not the keyboard is open, so add the open keyboard back.
  const availableHeight = useDerivedValue(() =>
    expanded
      ? maxHeight.value
      : derivePendingUserInputCompactHeight(
          maxHeight.value + Math.abs(keyboardHeight.value),
          lastKeyboardHeight.value,
        ),
  );
  const cardHeight = useDerivedValue(() =>
    expanded ? availableHeight.value : measuredCardHeight.value,
  );
  const heightStyle = useAnimatedStyle(() => ({
    height: expanded ? availableHeight.value : undefined,
    maxHeight: availableHeight.value,
  }));
  const clippingStyle = useAnimatedStyle(() => ({ height: availableHeight.value }));
  const toggleExpanded = () => {
    Keyboard.dismiss();
    props.onInputFocusChange?.(false);
    setExpanded((value) => !value);
  };
  const navigateToQuestion = (index: number) => {
    Keyboard.dismiss();
    props.onInputFocusChange?.(false);
    setQuestionIndex(index);
  };

  const cardCoverage = props.cardCoverage;
  const barHeight = useSharedValue(0);
  useAnimatedReaction(
    () => (showExpandedModal ? 0 : Math.max(0, cardHeight.value - barHeight.value)),
    (coverage) => {
      cardCoverage.set(coverage);
    },
  );
  const cardProgress = props.cardProgress;
  // iOS does not crossfade: the opaque card slides its full height past the clipping window.
  // Android fades across the coverage travel so hit-testing stays inside the parent.
  const cardAnimatedStyle = useAnimatedStyle(() => {
    const progress = cardProgress.value;
    const travel = Platform.OS === "android" ? cardCoverage.value : cardHeight.value;
    return {
      opacity:
        Platform.OS === "android"
          ? Math.min(1, (progress * cardHeight.value) / Math.max(1, cardHeight.value - travel))
          : 1,
      transform: [{ translateY: (1 - progress) * travel }],
    };
  });
  // Android hit-tests inside the parent; its height is also the space the card takes below the feed.
  const androidBoundsStyle = useAnimatedStyle(() => ({
    paddingTop: cardCoverage.value * cardProgress.value,
  }));

  const stopButton = props.onStopThread ? (
    <ControlPill
      accessibilityLabel={gt("Stop", { $context: "verb, stops the thread" })}
      icon="stop.fill"
      variant="danger"
      className="h-9 w-9"
      disabled={!props.canOperateThread}
      onPress={props.onStopThread}
    />
  ) : null;
  // The opaque bar renders under the card, whose top edge reveals it while collapsing.
  const bar = (
    <View
      onLayout={(event) => {
        barHeight.set(event.nativeEvent.layout.height);
      }}
      pointerEvents={props.collapsed ? "auto" : "none"}
      accessibilityElementsHidden={!props.collapsed}
      importantForAccessibility={props.collapsed ? "auto" : "no-hide-descendants"}
      className="flex-row items-center gap-2 rounded-full border border-border bg-card-alt py-1.5 pl-4 pr-1.5"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={gt(
          "{count, plural, one {Expand user input, {count} question} other {Expand user input, {count} questions}}",
          { count: questionCount },
        )}
        onPress={props.onToggleCollapsed}
        className="min-h-10 flex-1 flex-row items-center gap-2 active:opacity-70"
      >
        <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
          <T>User input needed</T>
        </Text>
        <Text className="font-sans text-xs text-foreground-muted">
          <T>
            <Plural
              n={questionCount}
              one={
                <>
                  <Var>{questionCount}</Var> question
                </>
              }
              other={
                <>
                  <Var>{questionCount}</Var> questions
                </>
              }
            />
          </T>
        </Text>
        <View className="flex-1" />
        <SymbolView
          name="chevron.up"
          size={12}
          tintColorClassName={"accent-icon-subtle"}
          type="monochrome"
        />
      </Pressable>
      {stopButton}
    </View>
  );
  const content = (
    <>
      <View className="flex-row items-start gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            expanded
              ? gt("Lower to compact questions")
              : props.expandInPane
                ? gt("Expand")
                : gt("Expand questions to full screen")
          }
          accessibilityState={{ expanded }}
          onPress={toggleExpanded}
          className="min-h-11 flex-1 flex-row items-center gap-2"
        >
          <View className="flex-1 gap-2.5">
            <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
              <T>User input needed</T>
            </Text>
            <Text className="font-t3-bold text-lg text-foreground">
              {paginated
                ? gt("Question {current} of {total}", {
                    current: activeQuestionIndex + 1,
                    total: questionCount,
                  })
                : gt("Fill in the pending answers")}
            </Text>
          </View>
          <View className="h-11 w-11 items-center justify-center rounded-full bg-subtle-strong">
            <SymbolView
              name={expanded ? "chevron.down" : "chevron.up"}
              size={13}
              tintColorClassName="accent-icon-subtle"
              type="monochrome"
            />
          </View>
        </Pressable>
        {stopButton}
        <ControlPill
          accessibilityLabel={gt("Collapse user input")}
          icon="chevron.down"
          className="h-11 w-11"
          onPress={props.onToggleCollapsed}
        />
      </View>
      {!canRespond ? (
        <Text className="font-sans text-sm leading-5 text-foreground-muted">
          <T>
            The provider process for this request is no longer available. Interrupt or restart the
            run to continue.
          </T>
        </Text>
      ) : null}
      {visibleQuestions.map((question) => {
        const draft = props.drafts[question.id];
        return (
          <View key={question.id} className="gap-2 pt-1">
            <Text
              className="font-t3-bold text-xs uppercase tracking-[1px] text-foreground-muted"
              style={proseDirectionStyle(question.header, setDirection)}
            >
              {question.header}
            </Text>
            <QuestionText
              markdown={question.question}
              environmentId={props.environmentId}
              threadId={props.threadId}
              workspaceRoot={props.workspaceRoot}
              setDirection={setDirection}
              preserveSoftBreaks
            />
            <View className="gap-2">
              {question.options.map((option) => {
                const optionValue = option.value ?? option.label.trim();
                const selected = isPendingUserInputOptionSelected(question, draft, optionValue);
                const description =
                  option.description !== option.label ? option.description : undefined;
                return (
                  <View key={optionValue} className="gap-1.5">
                    <Pressable
                      accessibilityRole={question.multiSelect ? "checkbox" : "radio"}
                      accessibilityState={{ checked: selected, disabled: responseDisabled }}
                      disabled={responseDisabled}
                      className={cn(
                        "min-h-12 w-full rounded-2xl border px-3.5 py-3",
                        selected ? "border-primary bg-primary/10" : "border-border bg-input",
                      )}
                      onPress={() =>
                        props.onSelectOption(
                          props.pendingUserInput.requestId,
                          question,
                          optionValue,
                        )
                      }
                    >
                      <View className="min-w-0 flex-1 gap-0.5">
                        <Text
                          className={cn(
                            "font-t3-bold text-sm",
                            selected ? "text-foreground" : "text-foreground-secondary",
                          )}
                          style={proseDirectionStyle(option.label, setDirection)}
                        >
                          {option.label}
                        </Text>
                        {description ? (
                          <Text
                            className="font-sans text-sm leading-5 text-foreground-muted"
                            style={proseDirectionStyle(description, setDirection)}
                          >
                            {description}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                    {option.preview ? (
                      <View className="px-3.5">
                        <QuestionText
                          markdown={option.preview}
                          environmentId={props.environmentId}
                          threadId={props.threadId}
                          workspaceRoot={props.workspaceRoot}
                          setDirection={setDirection}
                          preserveSoftBreaks
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
            {question.allowCustomAnswer !== false ? (
              <QuestionAttachments
                key={`${props.pendingUserInput.requestId}:${question.id}`}
                requestId={props.pendingUserInput.requestId}
                question={question}
                questions={props.pendingUserInput.questions}
                disabled={responseDisabled}
                value={draft?.customAnswer ?? ""}
                onChangeText={(value) =>
                  props.onChangeCustomAnswer(props.pendingUserInput.requestId, question.id, value)
                }
                onInputFocusChange={props.onInputFocusChange}
              />
            ) : null}
          </View>
        );
      })}
      {paginated && isLastQuestion && props.answers === null ? (
        <Text className="font-sans text-xs text-foreground-muted">
          {questionCount > 1
            ? gt("Answer every question before submitting. Use Back to review earlier answers.")
            : gt("Choose an option or enter an answer before submitting.")}
        </Text>
      ) : null}
      <View className="flex-row gap-3">
        {paginated && questionCount > 1 ? (
          <View className="flex-1">
            <Button
              label={gt("Back")}
              fullWidth
              tone="secondary"
              disabled={activeQuestionIndex === 0 || isResponding}
              onPress={() => navigateToQuestion(activeQuestionIndex - 1)}
            />
          </View>
        ) : null}
        <View className="flex-1">
          <Button
            label={
              isResponding ? gt("Submitting…") : showSubmit ? gt("Submit answers") : gt("Next")
            }
            fullWidth
            tone={showSubmit && props.answers === null ? "secondary" : "primary"}
            disabled={
              isResponding ||
              (showSubmit &&
                (!props.canOperateThread || responseDisabled || props.answers === null))
            }
            onPress={() => {
              if (showSubmit) void props.onSubmit();
              else navigateToQuestion(activeQuestionIndex + 1);
            }}
          />
        </View>
      </View>
      {props.pendingUserInput.dismissible ? (
        <Button
          label={gt("Dismiss without answering")}
          tone="text"
          disabled={isResponding}
          onPress={() => void props.onDismiss()}
        />
      ) : null}
      {!props.canOperateThread ? (
        <Text className="font-sans text-xs text-foreground-tertiary">
          <T>This connection cannot submit answers.</T>
        </Text>
      ) : null}
    </>
  );
  if (showExpandedModal) {
    return (
      <View onLayout={props.onLayout}>
        {bar}
        <Modal
          visible={focused && !props.collapsed}
          presentationStyle="fullScreen"
          supportedOrientations={["portrait", "landscape-left", "landscape-right"]}
          onRequestClose={props.onToggleCollapsed}
        >
          <View className="flex-1 bg-card-alt">
            <SafeAreaProvider>
              <SafeAreaView style={{ flex: 1 }}>
                <KeyboardAvoidingView
                  style={{ flex: 1 }}
                  behavior={Platform.OS === "ios" ? "padding" : undefined}
                >
                  <ScrollView
                    key={paginated ? question?.id : "scroll"}
                    className="flex-1"
                    contentContainerClassName="gap-2.5 p-4"
                    keyboardShouldPersistTaps="handled"
                  >
                    {content}
                  </ScrollView>
                </KeyboardAvoidingView>
              </SafeAreaView>
            </SafeAreaProvider>
          </View>
        </Modal>
      </View>
    );
  }
  const card = (
    <Animated.View
      onLayout={(event) => measuredCardHeight.set(event.nativeEvent.layout.height)}
      pointerEvents={props.collapsed ? "none" : "auto"}
      accessibilityElementsHidden={props.collapsed}
      importantForAccessibility={props.collapsed ? "no-hide-descendants" : "auto"}
      className="overflow-hidden gap-2.5 rounded-[20px] border border-border bg-card-alt p-4"
      style={[heightStyle, cardAnimatedStyle]}
    >
      <ScrollView
        key={paginated ? question?.id : "scroll"}
        className="min-h-0"
        contentContainerClassName="gap-2.5 pb-1"
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {content}
      </ScrollView>
    </Animated.View>
  );
  return (
    <Animated.View
      className="relative"
      style={Platform.OS === "android" ? androidBoundsStyle : undefined}
      onLayout={props.onLayout}
    >
      {bar}
      {/* Clipping window for the collapse slide, bottom edge on the bar's: the card exits
          through it instead of drawing over the composer, wiping the bar into view. */}
      <Animated.View
        pointerEvents={props.collapsed ? "none" : "box-none"}
        className="absolute inset-x-0 bottom-0 justify-end overflow-hidden"
        style={clippingStyle}
      >
        {card}
      </Animated.View>
    </Animated.View>
  );
}
