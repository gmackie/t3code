import { useEffect } from "react";

import { Button } from "../ui/button";
import { ComposerBanner } from "./ComposerBanner";
import type {
  ComposerReviewAction,
  ComposerReviewSuggestion,
} from "@t3tools/client-runtime/plugins";

/**
 * Body of the prompt coach notice: plugin tips, the proposed rewrite, and the
 * four ways out. Escape dismisses unless something else already handled it.
 */
export function ComposerReviewCard({
  suggestion,
  onAction,
}: {
  readonly suggestion: ComposerReviewSuggestion;
  readonly onAction: (action: ComposerReviewAction) => void;
}) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers Escape with the mounted review card and removes the listener when it closes
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onAction("dismiss");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onAction]);

  return (
    <ComposerBanner.Body className="space-y-2 pe-2 pb-1 whitespace-normal">
      {suggestion.tips.length > 0 ? (
        <ul className="space-y-1 text-muted-foreground" aria-label="Prompt tips">
          {suggestion.tips.map((tip) => (
            <li key={`${tip.pattern}:${tip.message}`} className="text-pretty">
              {tip.message}
            </li>
          ))}
        </ul>
      ) : null}
      {suggestion.rewrite !== undefined ? (
        <figure className="space-y-1">
          <figcaption className="font-medium text-muted-foreground">Suggested rewrite</figcaption>
          <blockquote className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/55 bg-background/55 px-2 py-1.5 text-foreground/90">
            {suggestion.rewrite}
          </blockquote>
        </figure>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        {suggestion.rewrite !== undefined ? (
          <Button size="xs" onClick={() => onAction("accept")}>
            Accept rewrite
          </Button>
        ) : null}
        <Button size="xs" variant="outline" onClick={() => onAction("original")}>
          Send original
        </Button>
        <Button
          size="xs"
          variant="ghost"
          aria-keyshortcuts="Escape"
          onClick={() => onAction("dismiss")}
        >
          Dismiss
        </Button>
        <Button size="xs" variant="ghost-muted" onClick={() => onAction("mute")}>
          Mute this thread
        </Button>
      </div>
    </ComposerBanner.Body>
  );
}
