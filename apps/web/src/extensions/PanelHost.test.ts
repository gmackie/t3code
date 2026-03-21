import { describe, expect, it } from "vitest";

import type { PanelContext, PanelDefinition } from "./types";
import { getAvailablePanelsForSurface } from "./registry";

function makeContext(overrides: Partial<PanelContext> = {}): PanelContext {
  return {
    activeThreadId: null,
    threadView: null,
    ...overrides,
  };
}

function makePanel(
  overrides: Partial<PanelDefinition> & Pick<PanelDefinition, "id" | "title">,
): PanelDefinition {
  return {
    surface: "thread.sidePanel",
    order: 0,
    isAvailable: () => true,
    render: () => null,
    ...overrides,
  };
}

describe("PanelHost behavior", () => {
  describe("panel selection logic", () => {
    it("selects the first available panel when no panel is explicitly selected", () => {
      const panels = [
        makePanel({ id: "overview", title: "Overview", order: 0 }),
        makePanel({ id: "planning", title: "Planning", order: 5 }),
      ];
      const available = getAvailablePanelsForSurface(panels, "thread.sidePanel", makeContext());
      // First available is the one with lowest order
      expect(available[0]?.id).toBe("overview");
    });

    it("falls back to next available when selected panel becomes unavailable", () => {
      const panels = [
        makePanel({ id: "overview", title: "Overview", order: 0 }),
        makePanel({ id: "planning", title: "Planning", order: 5, isAvailable: () => false }),
      ];
      const available = getAvailablePanelsForSurface(panels, "thread.sidePanel", makeContext());
      // Planning is unavailable, only overview remains
      expect(available).toHaveLength(1);
      expect(available[0]?.id).toBe("overview");
    });

    it("returns empty array when no panels are available", () => {
      const panels = [
        makePanel({ id: "overview", title: "Overview", isAvailable: () => false }),
      ];
      const available = getAvailablePanelsForSurface(panels, "thread.sidePanel", makeContext());
      expect(available).toHaveLength(0);
    });
  });

  describe("availability filtering", () => {
    it("passes context to isAvailable for conditional panels", () => {
      const panels = [
        makePanel({
          id: "project-only",
          title: "Project Panel",
          isAvailable: (ctx) => ctx.threadView?.project !== null && ctx.threadView !== null,
        }),
      ];

      // No thread view — panel should not be available
      const withoutThread = getAvailablePanelsForSurface(
        panels,
        "thread.sidePanel",
        makeContext(),
      );
      expect(withoutThread).toHaveLength(0);
    });
  });

  describe("ordering", () => {
    it("sorts by order ascending, then by title alphabetically", () => {
      const panels = [
        makePanel({ id: "c", title: "Charlie", order: 10 }),
        makePanel({ id: "a", title: "Alpha", order: 10 }),
        makePanel({ id: "z", title: "Zulu", order: 0 }),
      ];
      const available = getAvailablePanelsForSurface(panels, "thread.sidePanel", makeContext());
      expect(available.map((p) => p.id)).toEqual(["z", "a", "c"]);
    });

    it("defaults order to 0 when not specified", () => {
      const panels = [
        makePanel({ id: "explicit", title: "Explicit", order: 1 }),
        makePanel({ id: "default", title: "Default" }), // order defaults to 0
      ];
      const available = getAvailablePanelsForSurface(panels, "thread.sidePanel", makeContext());
      expect(available[0]?.id).toBe("default");
    });
  });

  describe("error boundary integration", () => {
    it("PanelDefinition render function receives PanelContext", () => {
      let receivedContext: PanelContext | null = null;
      const panel = makePanel({
        id: "test",
        title: "Test",
        render: (ctx) => {
          receivedContext = ctx;
          return null;
        },
      });

      const context = makeContext();
      panel.render(context);

      expect(receivedContext).toBe(context);
    });
  });
});
