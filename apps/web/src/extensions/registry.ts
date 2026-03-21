import type { ExtensionContext, ExtensionSurface, T3ExtensionDefinition } from "./types";

export function getAvailableExtensionsForSurface(
  extensions: ReadonlyArray<T3ExtensionDefinition>,
  surface: ExtensionSurface,
  context: ExtensionContext,
): T3ExtensionDefinition[] {
  return extensions
    .filter((extension) => extension.surface === surface)
    .filter((extension) => extension.isAvailable(context))
    .toSorted((left, right) => {
      const byOrder = (left.order ?? 0) - (right.order ?? 0);
      if (byOrder !== 0) return byOrder;
      return left.title.localeCompare(right.title);
    });
}
