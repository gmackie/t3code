import { assert, it } from "@effect/vitest";

import {
  resolveGmackoBaseVersion,
  resolveGmackoReleaseMetadata,
} from "./resolve-gmacko-release.ts";

it("strips prerelease and build metadata without bumping the gmacko base version", () => {
  assert.equal(resolveGmackoBaseVersion("0.0.21"), "0.0.21");
  assert.equal(resolveGmackoBaseVersion("0.0.21-gmacko.202604300228"), "0.0.21");
  assert.equal(resolveGmackoBaseVersion("1.2.3-beta.4+build.9"), "1.2.3");
});

it("derives gmacko metadata for the fork release stream", () => {
  assert.deepStrictEqual(resolveGmackoReleaseMetadata("0.0.21", "202604300228"), {
    baseVersion: "0.0.21",
    version: "0.0.21-gmacko.202604300228",
    tag: "v0.0.21-gmacko.202604300228",
    name: "T3 Code (gmacko) 0.0.21-gmacko.202604300228",
  });
});
