import { PanelRightCloseIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { cn } from "~/lib/utils";
import type { PanelDefinition } from "./types";

interface PanelSidePanelProps {
  panels: ReadonlyArray<PanelDefinition>;
  activePanelId: string | null;
  onSelectPanel: (panelId: string) => void;
  onClose: () => void;
  children: React.ReactNode;
}

export function PanelSidePanel(props: PanelSidePanelProps) {
  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-l border-border/70 bg-card/50">
      <div
        role="tablist"
        className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3"
      >
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          {props.panels.map((panel) => (
            <button
              key={panel.id}
              type="button"
              role="tab"
              aria-selected={props.activePanelId === panel.id}
              onClick={() => props.onSelectPanel(panel.id)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                props.activePanelId === panel.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {panel.title}
            </button>
          ))}
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={props.onClose}
          aria-label="Close panel sidebar"
          className="text-muted-foreground/50 hover:text-foreground/70"
        >
          <PanelRightCloseIcon className="size-3.5" />
        </Button>
      </div>
      {props.children}
    </div>
  );
}
