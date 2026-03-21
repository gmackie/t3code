import { Component, type ErrorInfo, type ReactNode, useMemo, useState } from "react";

import { PanelSidePanel } from "./PanelSidePanel";
import { getAvailablePanelsForSurface } from "./registry";
import type { PanelContext, PanelDefinition } from "./types";

interface PanelHostProps {
  panels: ReadonlyArray<PanelDefinition>;
  context: PanelContext;
  open: boolean;
  onClose: () => void;
}

class PanelErrorBoundary extends Component<
  { children: ReactNode; panelId: string },
  { error: Error | null }
> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Panel "${this.props.panelId}" crashed:`, error, info);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
            <p className="text-sm font-medium text-destructive">Panel error</p>
            <p className="mt-1 text-xs text-muted-foreground">{this.state.error.message}</p>
            <button
              type="button"
              className="mt-3 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
              onClick={() => this.setState({ error: null })}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function PanelHost(props: PanelHostProps) {
  const availablePanels = useMemo(
    () => getAvailablePanelsForSurface(props.panels, "thread.sidePanel", props.context),
    [props.context, props.panels],
  );
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);

  const activePanel = useMemo(() => {
    if (availablePanels.length === 0) return null;
    if (selectedPanelId) {
      const selected = availablePanels.find((p) => p.id === selectedPanelId);
      if (selected) return selected;
    }
    return availablePanels[0] ?? null;
  }, [availablePanels, selectedPanelId]);

  if (!props.open || !activePanel) {
    return null;
  }

  return (
    <PanelSidePanel
      panels={availablePanels}
      activePanelId={activePanel.id}
      onSelectPanel={setSelectedPanelId}
      onClose={props.onClose}
    >
      <PanelErrorBoundary key={activePanel.id} panelId={activePanel.id}>
        {activePanel.render(props.context)}
      </PanelErrorBoundary>
    </PanelSidePanel>
  );
}
