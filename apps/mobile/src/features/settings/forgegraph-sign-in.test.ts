import type { SourceControlDiscoveryResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { forgeGraphDiscoveryAuth } from "./forgegraph-sign-in";

function discovery(
  providers: SourceControlDiscoveryResult["sourceControlProviders"],
): SourceControlDiscoveryResult {
  return { versionControlSystems: [], sourceControlProviders: providers };
}

type ProviderItem = SourceControlDiscoveryResult["sourceControlProviders"][number];

function provider(
  kind: string,
  status: "authenticated" | "unauthenticated" | "unknown",
  host: string | null,
): ProviderItem {
  return {
    kind: kind as ProviderItem["kind"],
    label: kind,
    status: "available",
    version: Option.none(),
    installHint: "Install it.",
    detail: Option.none(),
    auth: {
      status,
      account: Option.some("someone"),
      host: Option.fromNullishOr(host),
      detail: Option.none(),
    },
  };
}

describe("forgeGraphDiscoveryAuth", () => {
  it("hides the section until discovery finds ForgeGraph", () => {
    expect(forgeGraphDiscoveryAuth(null)).toBeNull();
    expect(
      forgeGraphDiscoveryAuth(discovery([provider("github", "authenticated", "github.com")])),
    ).toBeNull();
  });

  it("reads sign-in and host from the ForgeGraph entry without the account", () => {
    expect(
      forgeGraphDiscoveryAuth(
        discovery([
          provider("github", "unauthenticated", null),
          provider("forgegraph", "authenticated", "forgegraf.com"),
        ]),
      ),
    ).toStrictEqual({ signedIn: true, host: "forgegraf.com" });
    expect(
      forgeGraphDiscoveryAuth(discovery([provider("forgegraph", "unknown", null)])),
    ).toStrictEqual({ signedIn: false, host: null });
  });
});
