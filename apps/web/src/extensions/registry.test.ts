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

describe("panel registry", () => {
  it("returns only available panels ordered by order then title", () => {
    const panels = [
      makePanel({ id: "z-last", title: "Zulu", order: 20 }),
      makePanel({ id: "hidden", title: "Hidden", order: 1, isAvailable: () => false }),
      makePanel({ id: "a-first", title: "Alpha", order: 10 }),
      makePanel({ id: "b-second", title: "Beta", order: 10 }),
    ] satisfies ReadonlyArray<PanelDefinition>;

    const available = getAvailablePanelsForSurface(panels, "thread.sidePanel", makeContext());

    expect(available.map((p) => p.id)).toEqual(["a-first", "b-second", "z-last"]);
  });
});
