import { describe, expect, it } from "vitest";

import type { ExtensionContext, T3ExtensionDefinition } from "./types";
import { getAvailableExtensionsForSurface } from "./registry";

function makeContext(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    activeThreadId: null,
    threadView: null,
    openSidePanel: () => {},
    closeSidePanel: () => {},
    actions: [],
    ...overrides,
  };
}

function makeExtension(
  overrides: Partial<T3ExtensionDefinition> &
    Pick<T3ExtensionDefinition, "id" | "title" | "surface">,
): T3ExtensionDefinition {
  return {
    order: 0,
    isAvailable: () => true,
    render: () => null,
    ...overrides,
  };
}

describe("extension registry", () => {
  it("returns only available extensions for the requested surface ordered by order then title", () => {
    const extensions = [
      makeExtension({
        id: "z-last",
        title: "Zulu",
        surface: "thread.sidePanel",
        order: 20,
      }),
      makeExtension({
        id: "hidden",
        title: "Hidden",
        surface: "thread.sidePanel",
        order: 1,
        isAvailable: () => false,
      }),
      makeExtension({
        id: "header-action",
        title: "Header Action",
        surface: "thread.headerActions",
        order: 0,
      }),
      makeExtension({
        id: "a-first",
        title: "Alpha",
        surface: "thread.sidePanel",
        order: 10,
      }),
      makeExtension({
        id: "b-second",
        title: "Beta",
        surface: "thread.sidePanel",
        order: 10,
      }),
    ] satisfies ReadonlyArray<T3ExtensionDefinition>;

    const available = getAvailableExtensionsForSurface(
      extensions,
      "thread.sidePanel",
      makeContext(),
    );

    expect(available.map((extension) => extension.id)).toEqual(["a-first", "b-second", "z-last"]);
  });
});
