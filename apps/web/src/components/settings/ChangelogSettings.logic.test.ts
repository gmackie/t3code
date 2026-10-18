import { describe, expect, it } from "vite-plus/test";

import { nightlyShipStatus, parseUpstreamChanges } from "./ChangelogSettings.logic";

describe("parseUpstreamChanges", () => {
  it("reads GitHub's generated release note bullets", () => {
    const body = [
      "## What's Changed",
      "* perf(web): switching threads no longer re-renders the chat view by @juliusmarminge in https://github.com/pingdotgg/t3code/pull/21130",
      "* chore: bump deps by @dependabot[bot] in https://github.com/pingdotgg/t3code/pull/21131",
      "- A hand-written note",
      "",
      "**Full Changelog**: https://github.com/pingdotgg/t3code/compare/a...b",
    ].join("\n");

    expect(parseUpstreamChanges(body)).toEqual([
      {
        title: "perf(web): switching threads no longer re-renders the chat view",
        author: "juliusmarminge",
        pullRequestUrl: "https://github.com/pingdotgg/t3code/pull/21130",
        pullRequestNumber: 21130,
      },
      {
        title: "chore: bump deps",
        author: "dependabot[bot]",
        pullRequestUrl: "https://github.com/pingdotgg/t3code/pull/21131",
        pullRequestNumber: 21131,
      },
      { title: "A hand-written note", author: null, pullRequestUrl: null, pullRequestNumber: null },
    ]);
  });
});

describe("nightlyShipStatus", () => {
  const installed = "0.0.45-gmacko.202610162327";

  it("separates nightlies in the installed build from ones in newer builds", () => {
    expect(nightlyShipStatus(null, installed)).toEqual({ kind: "unshipped" });
    expect(nightlyShipStatus("0.0.45-gmacko.202610151931", installed)).toEqual({
      kind: "installed",
      version: "0.0.45-gmacko.202610151931",
    });
    expect(nightlyShipStatus(installed, installed).kind).toBe("installed");
    expect(nightlyShipStatus("0.0.46-gmacko.202610180000", installed).kind).toBe("newer");
  });

  it("treats dev builds as including nothing", () => {
    expect(nightlyShipStatus("0.0.45-gmacko.202610151931", "0.0.0").kind).toBe("newer");
  });
});
