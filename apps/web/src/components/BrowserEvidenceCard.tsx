"use client";

import type { BrowserToolEvidence } from "../session-logic";
import { cn } from "../lib/utils";

interface BrowserEvidenceCardProps {
  evidence: BrowserToolEvidence;
  heading: string;
  className?: string;
}

export function BrowserEvidenceCard({ evidence, heading, className }: BrowserEvidenceCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/80 bg-background/92 p-3 text-[12px] shadow-lg/10 backdrop-blur",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{heading}</p>
          {evidence.title ? (
            <p className="truncate text-muted-foreground">{evidence.title}</p>
          ) : evidence.url ? (
            <p className="truncate text-muted-foreground">{evidence.url}</p>
          ) : null}
        </div>
        {evidence.loadingState ? (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {evidence.loadingState}
          </span>
        ) : null}
      </div>
      {evidence.lastError ? (
        <p className="mt-2 rounded-md border border-red-500/20 bg-red-500/8 px-2 py-1 text-red-700 dark:text-red-300/92">
          {evidence.lastError}
        </p>
      ) : null}
      {evidence.loadingState ? (
        <p className="mt-2 text-foreground/88">Loading: {evidence.loadingState}</p>
      ) : null}
      {(evidence.consoleMessages?.length ?? 0) > 0 ? (
        <div className="mt-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Console
          </p>
          <p className="line-clamp-2 text-foreground/88">
            {evidence.consoleMessages?.slice(0, 2).join(" · ")}
          </p>
        </div>
      ) : null}
      {(evidence.networkErrors?.length ?? 0) > 0 ? (
        <div className="mt-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Network
          </p>
          <p className="line-clamp-2 text-foreground/88">
            {evidence.networkErrors?.slice(0, 2).join(" · ")}
          </p>
        </div>
      ) : null}
      {(evidence.elements?.length ?? 0) > 0 ? (
        <div className="mt-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Elements
          </p>
          <p className="line-clamp-2 text-foreground/88">
            {evidence.elements
              ?.slice(0, 2)
              .map((element) => `${element.role} "${element.name}"`)
              .join(" · ")}
          </p>
        </div>
      ) : null}
      {evidence.screenshotDataUrl ? (
        <img
          src={evidence.screenshotDataUrl}
          alt="Latest browser evidence screenshot"
          className="mt-3 max-h-36 w-full rounded-lg border border-border/70 object-cover"
        />
      ) : null}
    </div>
  );
}
