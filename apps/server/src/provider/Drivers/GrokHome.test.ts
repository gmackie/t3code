import { expect, it } from "@effect/vitest";
import { resolveEffectiveGrokHome } from "./GrokHome.ts";

it("uses configured, ambient, then default Grok home precedence and expands tilde", () => {
  expect(
    resolveEffectiveGrokHome({
      configuredHomePath: "",
      environment: { GROK_HOME: "/tmp/ambient" },
      userHome: "/Users/test",
    }),
  ).toBe("/tmp/ambient");
  expect(
    resolveEffectiveGrokHome({
      configuredHomePath: "~/custom",
      environment: { GROK_HOME: "/tmp/ambient" },
      userHome: "/Users/test",
    }),
  ).toBe("/Users/test/custom");
  expect(
    resolveEffectiveGrokHome({ configuredHomePath: "", environment: {}, userHome: "/Users/test" }),
  ).toBe("/Users/test/.grok");
});
