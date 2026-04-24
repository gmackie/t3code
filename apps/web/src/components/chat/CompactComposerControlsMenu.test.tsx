import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";

describe("CompactComposerControlsMenu", () => {
  it("does not crash when legacy compact-plan props omit the sidebar label", () => {
    expect(() =>
      renderToStaticMarkup(
        <CompactComposerControlsMenu
          {...({
            activePlan: true,
            interactionMode: "plan",
            planSidebarOpen: true,
            runtimeMode: "approval-required",
            onToggleInteractionMode: vi.fn(),
            onTogglePlanSidebar: vi.fn(),
            onToggleRuntimeMode: vi.fn(),
          } as any)}
        />,
      ),
    ).not.toThrow();
  });

  it("renders with the current runtime mode handler", () => {
    expect(() =>
      renderToStaticMarkup(
        <CompactComposerControlsMenu
          activePlan
          interactionMode="plan"
          planSidebarLabel="Plan"
          planSidebarOpen
          runtimeMode="approval-required"
          onToggleInteractionMode={vi.fn()}
          onTogglePlanSidebar={vi.fn()}
          onRuntimeModeChange={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });
});
