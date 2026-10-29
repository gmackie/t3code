// @effect-diagnostics globalTimers:off - this Promise adapter bounds UI waits and clears its deadline when the review settles.
import {
  PLUGIN_COMPOSER_REVIEW_MAX_DRAFT_CHARS,
  PLUGIN_COMPOSER_REVIEW_TIMEOUT_MS,
  type PluginComposerReviewDecision,
  type PluginComposerReviewResult,
} from "@t3tools/contracts";

/**
 * Pre-send prompt coach. Plugins may suggest tips and a rewrite before a draft
 * is sent; every failure path sends the draft unchanged.
 */
export type ComposerReviewSuggestion = Extract<PluginComposerReviewResult, { verdict: "suggest" }>;

export type ComposerReviewOutcome =
  | { readonly kind: "send" }
  | { readonly kind: "cancel" }
  | { readonly kind: "suggest"; readonly suggestion: ComposerReviewSuggestion };

export type ComposerReviewAction = "accept" | "original" | "dismiss" | "mute";

export interface ComposerReviewActionEffect {
  readonly decision: PluginComposerReviewDecision;
  /** Replace the draft with this text before anything else happens. */
  readonly nextDraft: string | null;
  /** Send right away, skipping review for that one submit. */
  readonly send: boolean;
  readonly muteThread: boolean;
}

const SEND: ComposerReviewOutcome = { kind: "send" };

/**
 * The review only runs for plain prose drafts. Slash commands and plan
 * refinements never reach this check because the send path handles them first;
 * the slash check here also covers provider-native commands such as `/compact`.
 */
export function shouldReviewComposerDraft(input: {
  readonly enabled: boolean;
  readonly threadMuted: boolean;
  readonly bypass: boolean;
  readonly draft: string;
}): boolean {
  if (!input.enabled || input.threadMuted || input.bypass) return false;
  const trimmed = input.draft.trim();
  if (trimmed.length === 0 || trimmed.startsWith("/")) return false;
  return input.draft.length <= PLUGIN_COMPOSER_REVIEW_MAX_DRAFT_CHARS;
}

/**
 * Decides whether a submit may go out now. When review applies, waits at most
 * `timeoutMs` for the plugin verdict; a rejected, empty, or late review sends
 * the draft unchanged.
 */
export async function gateComposerSend(
  input: Parameters<typeof shouldReviewComposerDraft>[0] & {
    readonly review: () => Promise<PluginComposerReviewResult | null>;
    readonly timeoutMs?: number;
    /** A changed draft or route cancels this submit, including a late pass. */
    readonly isCurrent?: () => boolean;
  },
): Promise<ComposerReviewOutcome> {
  if (!shouldReviewComposerDraft(input)) return SEND;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), input.timeoutMs ?? PLUGIN_COMPOSER_REVIEW_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([
      Promise.resolve()
        .then(input.review)
        .catch(() => null),
      deadline,
    ]);
    if (input.isCurrent?.() === false) return { kind: "cancel" };
    if (result?.verdict !== "suggest") return SEND;
    if (result.tips.length === 0 && result.rewrite === undefined) return SEND;
    return { kind: "suggest", suggestion: result };
  } finally {
    clearTimeout(timer);
  }
}

/** What each card button does, and which decision is reported to the plugin. */
export function resolveComposerReviewAction(
  suggestion: ComposerReviewSuggestion,
  action: ComposerReviewAction,
): ComposerReviewActionEffect {
  switch (action) {
    case "accept":
      return suggestion.rewrite === undefined
        ? { decision: "original", nextDraft: null, send: true, muteThread: false }
        : { decision: "accepted", nextDraft: suggestion.rewrite, send: true, muteThread: false };
    case "original":
      return { decision: "original", nextDraft: null, send: true, muteThread: false };
    case "dismiss":
      return { decision: "dismissed", nextDraft: null, send: false, muteThread: false };
    case "mute":
      // Muting keeps the draft so the next submit sends it without review.
      return { decision: "muted", nextDraft: null, send: false, muteThread: true };
  }
}
