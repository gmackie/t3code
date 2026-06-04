import type { PanelContext, PanelDefinition, PanelSurface } from "./types";

export function getAvailablePanelsForSurface(
  panels: ReadonlyArray<PanelDefinition>,
  surface: PanelSurface,
  context: PanelContext,
): PanelDefinition[] {
  return panels
    .filter((panel) => panel.surface === surface)
    .filter((panel) => panel.isAvailable(context))
    .toSorted((left, right) => {
      const byOrder = (left.order ?? 0) - (right.order ?? 0);
      if (byOrder !== 0) return byOrder;
      return left.title.localeCompare(right.title);
    });
}
