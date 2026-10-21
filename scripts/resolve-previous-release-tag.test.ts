import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { resolvePreviousReleaseTag } from "./resolve-previous-release-tag.ts";

it.effect("selects the latest earlier stable tag and ignores nightlies", () =>
  Effect.gen(function* () {
    const previous = yield* resolvePreviousReleaseTag("stable", "v1.2.0", [
      "v1.1.0",
      "v1.1.1-nightly.20260619.1",
      "v1.1.2",
      "v1.2.0",
    ]);

    assert.equal(previous, "v1.1.2");
  }),
);

it.effect("accepts legacy nightly tags when selecting the previous nightly", () =>
  Effect.gen(function* () {
    const previous = yield* resolvePreviousReleaseTag("nightly", "v1.2.0-nightly.20260620.2", [
      "nightly-v1.2.0-nightly.20260620.1",
      "v1.1.0-nightly.20260619.9",
    ]);

    assert.equal(previous, "nightly-v1.2.0-nightly.20260620.1");
  }),
);

it.effect("keeps preview tags in their own series", () =>
  Effect.gen(function* () {
    const previous = yield* resolvePreviousReleaseTag("preview", "v1.2.0-preview.20260620.2", [
      "v1.2.0-nightly.20260620.3",
      "v1.2.0-preview.20260620.1",
      "v1.2.0-gmacko.1",
      "v1.1.9",
    ]);
    assert.equal(previous, "v1.2.0-preview.20260620.1");
  }),
);

it.effect("keeps gmacko tags in their own series", () =>
  Effect.gen(function* () {
    const previous = yield* resolvePreviousReleaseTag("gmacko", "v1.2.0-gmacko.2", [
      "v1.2.0-nightly.20260620.3",
      "v1.2.0-gmacko.1",
      "v1.1.9",
    ]);
    assert.equal(previous, "v1.2.0-gmacko.1");

    const stable = yield* resolvePreviousReleaseTag("stable", "v1.2.0", [
      "v1.1.9",
      "v1.2.0-preview.20260620.1",
    ]);
    assert.equal(stable, "v1.1.9");
  }),
);
it.effect("resolves the previous gmacko tag independently from stable and nightly tags", () =>
  Effect.gen(function* () {
    const previous = yield* resolvePreviousReleaseTag("gmacko", "v0.0.21-gmacko.202604300228", [
      "v0.0.20",
      "v0.0.21-gmacko.202604280101",
      "v0.0.21-nightly.20260429.9",
      "v0.0.21-gmacko.202604290101",
    ]);

    assert.equal(previous, "v0.0.21-gmacko.202604290101");
  }),
);

it.effect("does not treat gmacko tags as stable release candidates", () =>
  Effect.gen(function* () {
    const previous = yield* resolvePreviousReleaseTag("stable", "v0.0.22", [
      "v0.0.20",
      "v0.0.21-gmacko.202604300228",
      "v0.0.21-nightly.20260429.9",
    ]);

    assert.equal(previous, "v0.0.20");
  }),
);
