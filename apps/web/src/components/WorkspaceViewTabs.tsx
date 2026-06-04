import type { DragEvent, ReactNode } from "react";
import type { ProjectCodeDocumentSymbol, ProjectCodeIntelligenceSource } from "@t3tools/contracts";
import { ListTreeIcon, MessageSquareIcon, TextWrapIcon, XIcon } from "lucide-react";

import type { WorkspaceFileTab } from "../workspaceViewStore";
import { basenameOfPath } from "../vscode-icons";
import { VscodeEntryIcon } from "./chat/VscodeEntryIcon";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { Toggle } from "./ui/toggle";
import { cn } from "../lib/utils";

interface WorkspaceViewTabsProps {
  extraTabs: ReadonlyArray<{
    id: string;
    label: string;
    icon: ReactNode;
    testId?: string;
    closable?: boolean;
    draggable?: boolean;
  }>;
  tabs: readonly WorkspaceFileTab[];
  activeTabId: string | null;
  codeIntelligenceSource: ProjectCodeIntelligenceSource;
  documentSymbols: readonly ProjectCodeDocumentSymbol[];
  theme: "light" | "dark";
  wordWrap: boolean;
  activeFileOpen: boolean;
  onSelectTab: (tabId: string | null) => void;
  onCloseTab: (tabId: string) => void;
  onDragStartFileTab?: (event: DragEvent<HTMLButtonElement>, tab: WorkspaceFileTab) => void;
  onDragStartExtraTab?: (event: DragEvent<HTMLButtonElement>, tabId: string) => void;
  onSelectSymbol: (symbol: ProjectCodeDocumentSymbol) => void;
  onWordWrapChange: (nextValue: boolean) => void;
}

function WorkspaceViewTabButton(props: {
  selected: boolean;
  label: string;
  reserveCloseSpace?: boolean;
  testId?: string;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.selected}
      data-testid={props.testId}
      draggable={props.draggable}
      className={cn(
        "group/tab flex min-w-0 max-w-56 items-center gap-2 rounded-t-md border border-b-0 border-transparent px-3 py-2 text-xs transition-colors",
        props.reserveCloseSpace ? "pr-8" : null,
        props.selected
          ? "border-border bg-background text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
      onDragStart={props.onDragStart}
      onClick={props.onClick}
    >
      {props.children}
      <span className="truncate">{props.label}</span>
    </button>
  );
}

export default function WorkspaceViewTabs({
  extraTabs,
  tabs,
  activeTabId,
  codeIntelligenceSource,
  documentSymbols,
  theme,
  wordWrap,
  activeFileOpen,
  onSelectTab,
  onCloseTab,
  onDragStartFileTab,
  onDragStartExtraTab,
  onSelectSymbol,
  onWordWrapChange,
}: WorkspaceViewTabsProps) {
  const showDocumentSymbols = activeFileOpen && documentSymbols.length > 0;

  return (
    <div
      className="border-b border-border bg-card/60 px-3 pt-2 sm:px-5"
      data-testid="workspace-view-tabs"
    >
      <div className="flex items-end gap-2">
        <div
          className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto"
          role="tablist"
          aria-label="Workspace tabs"
        >
          <WorkspaceViewTabButton
            selected={activeTabId === null}
            label="Chat"
            testId="workspace-tab-chat"
            onClick={() => onSelectTab(null)}
          >
            <MessageSquareIcon className="size-3.5 shrink-0" />
          </WorkspaceViewTabButton>
          {extraTabs.map((tab) => (
            <div key={tab.id} className="relative flex min-w-0 items-center">
              <WorkspaceViewTabButton
                selected={activeTabId === tab.id}
                label={tab.label}
                {...(tab.closable ? { reserveCloseSpace: true } : {})}
                {...(tab.draggable ? { draggable: true } : {})}
                {...(tab.testId ? { testId: tab.testId } : {})}
                onDragStart={(event) => {
                  onDragStartExtraTab?.(event, tab.id);
                }}
                onClick={() => onSelectTab(tab.id)}
              >
                {tab.icon}
              </WorkspaceViewTabButton>
              {tab.closable ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    "absolute right-1 top-1/2 size-5 -translate-y-1/2 rounded-sm opacity-70 transition-opacity hover:opacity-100 group-hover/tab:opacity-100",
                    activeTabId === tab.id ? "text-foreground" : "text-muted-foreground",
                  )}
                  aria-label={`Close ${tab.label} tab`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  <XIcon />
                </Button>
              ) : null}
            </div>
          ))}
          {tabs.map((tab) => {
            const selected = activeTabId === tab.id;
            const label = basenameOfPath(tab.relativePath);
            return (
              <div key={tab.id} className="relative flex min-w-0 items-center">
                <WorkspaceViewTabButton
                  selected={selected}
                  label={label}
                  reserveCloseSpace
                  testId={`workspace-tab-${tab.id}`}
                  draggable={onDragStartFileTab !== undefined}
                  onDragStart={(event) => {
                    onDragStartFileTab?.(event, tab);
                  }}
                  onClick={() => onSelectTab(tab.id)}
                >
                  <VscodeEntryIcon
                    pathValue={tab.relativePath}
                    kind="file"
                    theme={theme}
                    className="size-3.5 shrink-0"
                  />
                </WorkspaceViewTabButton>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    "absolute right-1 top-1/2 size-5 -translate-y-1/2 rounded-sm opacity-70 transition-opacity hover:opacity-100 group-hover/tab:opacity-100",
                    selected ? "text-foreground" : "text-muted-foreground",
                  )}
                  aria-label={`Close ${label} tab`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                >
                  <XIcon />
                </Button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          {showDocumentSymbols ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    aria-label="Show document symbols"
                    title={
                      codeIntelligenceSource === "typescript"
                        ? "Show TypeScript document symbols"
                        : "Show document symbols"
                    }
                  >
                    <ListTreeIcon className="size-3" />
                  </Button>
                }
              />
              <MenuPopup align="end" className="min-w-44">
                {documentSymbols.map((symbol) => (
                  <MenuItem
                    key={`${symbol.name}:${symbol.selectionRange.start.line}:${symbol.selectionRange.start.column}`}
                    className="min-h-7 gap-2 py-1 sm:text-xs"
                    onClick={() => onSelectSymbol(symbol)}
                  >
                    <span className="truncate">{symbol.name}</span>
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          ) : null}
          {activeFileOpen ? (
            <Toggle
              aria-label={wordWrap ? "Disable file line wrapping" : "Enable file line wrapping"}
              title={wordWrap ? "Disable line wrapping" : "Enable line wrapping"}
              variant="outline"
              size="xs"
              pressed={wordWrap}
              onPressedChange={(pressed) => {
                onWordWrapChange(Boolean(pressed));
              }}
            >
              <TextWrapIcon className="size-3" />
            </Toggle>
          ) : null}
        </div>
      </div>
    </div>
  );
}
