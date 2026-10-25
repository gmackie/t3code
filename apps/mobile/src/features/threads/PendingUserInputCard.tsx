import { Button } from "../../components/ui/Button";
import { QuestionAttachments } from "./QuestionAttachments";
import type { RuntimeRequestId } from "@t3tools/contracts";
import type { ThreadUserInputQuestion } from "@t3tools/client-runtime/state/thread-requests";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Keyboard, Platform, Pressable, ScrollView, View } from "react-native";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, {
  Easing,
  FadeInUp,
  FadeOutDown,
  useAnimatedStyle,
  useAnimatedReaction,
  useDerivedValue,
  useSharedValue,
  type DerivedValue,
  type SharedValue,
} from "react-native-reanimated";

import {
  derivePendingUserInputCompactHeight,
  USER_INPUT_TOGGLE_DURATION_MS,
} from "./pendingUserInputLayout";

import { mobilePreferencesAtom } from "../../state/preferences";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { cn } from "../../lib/cn";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { useOpenPullRequest } from "../../native/useOpenPullRequest";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import {
  isPendingUserInputOptionSelected,
  type PendingUserInput,
  type PendingUserInputDraftAnswer,
} from "../../lib/threadActivity";

export interface PendingUserInputCardProps {
  readonly canOperateThread: boolean;
  readonly pendingUserInput: PendingUserInput;
  readonly maxHeight: DerivedValue<number>;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  /** Renders a stop control on the collapsed bar, which replaces the composer. */
  readonly onStopThread?: () => void;
  /** 0 collapsed → 1 expanded; the host animates it from the tap handler on the UI thread. */
  readonly cardProgress?: SharedValue<number>;
  /** How far the expanded card extends above the bar; the host adds it to the feed's end inset. */
  readonly cardCoverage?: SharedValue<number>;
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

/** Android cannot hit-test overlays beyond their parent's bounds; render its expanded card in-flow. */
const EXPANDED_CARD_IS_OVERLAY = Platform.OS === "ios";

function QuestionText(props: { readonly markdown: string }) {
  const styles = useMarkdownPreviewStyles();
  const openLink = useOpenPullRequest();
  return (
    <SelectableMarkdownText
      markdown={props.markdown}
      textStyle={styles.nativeTextStyle}
      onLinkPress={(href) => void openLink(href)}
    />
  );
}

export function PendingUserInputCard(props: PendingUserInputCardProps) {
  const questionCount = props.pendingUserInput.questions.length;
  // Message responses start a new run and remain available after the provider exits.
  const canRespond = props.pendingUserInput.responseCapability !== "not_resumable";
  const isResponding = props.respondingUserInputId === props.pendingUserInput.requestId;
  const responseDisabled = !canRespond || isResponding;
  const [expanded, setExpanded] = useState(false);
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
    () => Math.max(0, cardHeight.value - barHeight.value),
    (coverage) => {
      if (cardCoverage) {
        cardCoverage.set(coverage);
      }
    },
  );
  const cardProgress = props.cardProgress;
  // No opacity: an opaque card slides its full height past the clipping window's bottom edge,
  // so the transcript is only revealed where the card has left, never crossfaded.
  const cardAnimatedStyle = useAnimatedStyle(() => {
    const progress = cardProgress === undefined ? 1 : cardProgress.value;
    return {
      transform: [{ translateY: (1 - progress) * cardHeight.value }],
    };
  });

  // Keep the iOS card mounted so expansion starts on the UI thread without waiting for React layout.
  const renderCard = EXPANDED_CARD_IS_OVERLAY || !props.collapsed;
  const showBar = props.collapsed || EXPANDED_CARD_IS_OVERLAY;
  // The opaque bar renders under the card, whose top edge reveals it while collapsing.
  const bar = showBar ? (
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
        accessibilityLabel={`Expand user input, ${questionCount} question${
          questionCount === 1 ? "" : "s"
        }`}
        onPress={props.onToggleCollapsed}
        className="min-h-10 flex-1 flex-row items-center gap-2 active:opacity-70"
      >
        <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
          User input needed
        </Text>
        <Text className="font-sans text-xs text-foreground-muted">
          {questionCount} question{questionCount === 1 ? "" : "s"}
        </Text>
        <View className="flex-1" />
        <SymbolView
          name="chevron.up"
          size={12}
          tintColorClassName={"accent-icon-subtle"}
          type="monochrome"
        />
      </Pressable>
      {props.onStopThread ? (
        <ControlPill
          accessibilityLabel="Stop"
          icon="stop.fill"
          variant="danger"
          className="h-9 w-9"
          disabled={!props.canOperateThread}
          onPress={props.onStopThread}
        />
      ) : null}
    </View>
  ) : null;
  const card = renderCard ? (
    // The surface is opaque on purpose: the card floats over the thread
    // feed with no blur behind it, so a translucent background renders
    // the questions on top of whatever message happens to sit underneath.
    <Animated.View
      onLayout={(event) => measuredCardHeight.set(event.nativeEvent.layout.height)}
      pointerEvents={props.collapsed ? "none" : "auto"}
      accessibilityElementsHidden={props.collapsed}
      importantForAccessibility={props.collapsed ? "no-hide-descendants" : "auto"}
      entering={
        EXPANDED_CARD_IS_OVERLAY
          ? undefined
          : FadeInUp.duration(USER_INPUT_TOGGLE_DURATION_MS).easing(Easing.out(Easing.cubic))
      }
      exiting={
        EXPANDED_CARD_IS_OVERLAY
          ? undefined
          : FadeOutDown.duration(USER_INPUT_TOGGLE_DURATION_MS).easing(Easing.out(Easing.cubic))
      }
      className="overflow-hidden gap-2.5 rounded-[20px] border border-border bg-card-alt p-4"
      style={[heightStyle, EXPANDED_CARD_IS_OVERLAY ? cardAnimatedStyle : undefined]}
    >
      <View className="flex-row items-start gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            expanded ? "Lower to compact questions" : "Expand questions to full screen"
          }
          accessibilityState={{ expanded }}
          onPress={toggleExpanded}
          className="min-h-11 flex-1 flex-row items-center gap-2"
        >
          <View className="flex-1 gap-2.5">
            <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
              User input needed
            </Text>
            <Text className="font-t3-bold text-lg text-foreground">
              {paginated
                ? `Question ${activeQuestionIndex + 1} of ${questionCount}`
                : "Fill in the pending answers"}
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
        {!expanded ? (
          <ControlPill
            accessibilityLabel="Collapse user input"
            icon="chevron.down"
            className="h-11 w-11"
            onPress={props.onToggleCollapsed}
          />
        ) : null}
      </View>
      <ScrollView
        key={paginated ? question?.id : "scroll"}
        bounces={false}
        className={cn("min-h-0", expanded && "flex-1")}
        contentContainerClassName="gap-2.5 pb-1"
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator
        style={{ flexShrink: 1 }}
      >
        {!canRespond ? (
          <Text className="font-sans text-sm leading-5 text-foreground-muted">
            The provider process for this request is no longer available. Interrupt or restart the
            run to continue.
          </Text>
        ) : null}
        {visibleQuestions.map((question) => {
          const draft = props.drafts[question.id];
          return (
            <View key={question.id} className="gap-2 pt-1">
              <Text className="font-t3-bold text-xs uppercase tracking-[1px] text-foreground-muted">
                {question.header}
              </Text>
              <QuestionText markdown={question.question} />
              <View className="gap-2">
                {question.options.map((option) => {
                  const optionValue = option.value ?? option.label.trim();
                  const selected = isPendingUserInputOptionSelected(question, draft, optionValue);
                  const description =
                    option.description !== option.label ? option.description : undefined;
                  return (
                    <Pressable
                      key={optionValue}
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
                        >
                          {option.label}
                        </Text>
                        {description ? (
                          <Text className="font-sans text-sm leading-5 text-foreground-muted">
                            {description}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {question.allowCustomAnswer !== false ? (
                <QuestionAttachments
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
              ? "Answer every question before submitting. Use Back to review earlier answers."
              : "Choose an option or enter an answer before submitting."}
          </Text>
        ) : null}
      </ScrollView>
      <View className="flex-row gap-3">
        {paginated && questionCount > 1 ? (
          <View className="flex-1">
            <Button
              label="Back"
              fullWidth
              tone="secondary"
              disabled={activeQuestionIndex === 0 || isResponding}
              onPress={() => navigateToQuestion(activeQuestionIndex - 1)}
            />
          </View>
        ) : null}
        <View className="flex-1">
          <Button
            label={isResponding ? "Submitting…" : showSubmit ? "Submit answers" : "Next"}
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
          label="Dismiss without answering"
          tone="text"
          disabled={isResponding}
          onPress={() => void props.onDismiss()}
        />
      ) : null}
      {!props.canOperateThread ? (
        <Text className="font-sans text-xs text-foreground-tertiary">
          This connection cannot submit answers.
        </Text>
      ) : null}
    </Animated.View>
  ) : null;
  return (
    <View className="relative">
      {bar}
      {EXPANDED_CARD_IS_OVERLAY ? (
        // Clipping window for the collapse slide, bottom edge on the bar's: the card exits
        // through it instead of drawing over the composer, wiping the bar into view.
        <Animated.View
          pointerEvents={props.collapsed ? "none" : "box-none"}
          className="absolute inset-x-0 bottom-0 justify-end overflow-hidden"
          style={clippingStyle}
        >
          {card}
        </Animated.View>
      ) : (
        card
      )}
    </View>
  );
}
