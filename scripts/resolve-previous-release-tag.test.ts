import { assert, it } from "@effect/vitest";

import { resolvePreviousReleaseTag } from "./resolve-previous-release-tag.ts";

it("resolves the previous gmacko tag independently from stable and nightly tags", () => {
  assert.equal(
    resolvePreviousReleaseTag("gmacko", "v0.0.21-gmacko.202604300228", [
      "v0.0.20",
      "v0.0.21-gmacko.202604280101",
      "v0.0.21-nightly.20260429.9",
      "v0.0.21-gmacko.202604290101",
    ]),
    "v0.0.21-gmacko.202604290101",
  );
});

it("does not treat gmacko tags as stable release candidates", () => {
  assert.equal(
    resolvePreviousReleaseTag("stable", "v0.0.22", [
      "v0.0.20",
      "v0.0.21-gmacko.202604300228",
      "v0.0.21-nightly.20260429.9",
    ]),
    "v0.0.20",
  );
});
