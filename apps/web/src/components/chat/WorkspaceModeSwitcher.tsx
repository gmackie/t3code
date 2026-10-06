import type { ScopedThreadRef } from "@t3tools/contracts";
import { selectSelectedRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";
import { cn } from "~/lib/utils";

/** Changes the workspace tools without navigating or interrupting the active agent. */
export function WorkspaceModeSwitcher({ threadRef }: { threadRef: ScopedThreadRef }) {
  const kind = useRightPanelStore(
    (state) => selectSelectedRightPanelSurface(state.byThreadKey, threadRef)?.kind,
  );
  return (
    <div
      role="group"
      aria-label="Workspace mode"
      className="electron-no-drag flex shrink-0 rounded-md border border-border p-0.5"
    >
      {(["Code", "CAD", "Game"] as const).map((label) => {
        const selected =
          label === "CAD"
            ? kind === "kicad"
            : label === "Game"
              ? kind === "game"
              : kind !== "kicad" && kind !== "game";
        return (
          <button
            key={label}
            type="button"
            aria-label={`Switch to ${label} mode`}
            aria-pressed={selected}
            className={cn(
              "rounded px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
            onClick={() => {
              const store = useRightPanelStore.getState();
              if (label === "CAD") store.open(threadRef, "kicad");
              else if (label === "Game") store.open(threadRef, "game");
              else if (kind === "game") store.closeSurface(threadRef, "game");
              else store.returnToCode(threadRef);
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
