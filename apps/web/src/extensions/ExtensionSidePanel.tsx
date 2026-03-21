import { PanelRightCloseIcon } from "lucide-react";

import { Button } from "../components/ui/button";
import { cn } from "~/lib/utils";
import type { T3ExtensionDefinition } from "./types";

interface ExtensionSidePanelProps {
  extensions: ReadonlyArray<T3ExtensionDefinition>;
  activeExtensionId: string | null;
  onSelectExtension: (extensionId: string) => void;
  onClose: () => void;
  children: React.ReactNode;
}

export function ExtensionSidePanel(props: ExtensionSidePanelProps) {
  return (
    <div className="flex h-full w-[360px] shrink-0 flex-col border-l border-border/70 bg-card/50">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
          {props.extensions.map((extension) => (
            <button
              key={extension.id}
              type="button"
              onClick={() => props.onSelectExtension(extension.id)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors",
                props.activeExtensionId === extension.id
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {extension.title}
            </button>
          ))}
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={props.onClose}
          aria-label="Close extension sidebar"
          className="text-muted-foreground/50 hover:text-foreground/70"
        >
          <PanelRightCloseIcon className="size-3.5" />
        </Button>
      </div>
      {props.children}
    </div>
  );
}
