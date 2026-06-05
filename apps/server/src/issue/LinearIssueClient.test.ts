import { assert, describe, it } from "@effect/vitest";

import { linearGraphqlUrl } from "./LinearIssueClient.ts";

describe("LinearIssueClient", () => {
  it("uses Linear's API host for the default Linear domain", () => {
    assert.equal(linearGraphqlUrl("linear.app"), "https://api.linear.app/graphql");
  });

  it("uses custom Linear-compatible domains directly", () => {
    assert.equal(linearGraphqlUrl("tasks.gmac.io"), "https://tasks.gmac.io/graphql");
  });

  it("preserves full custom Linear-compatible GraphQL URLs", () => {
    assert.equal(
      linearGraphqlUrl("https://tasks.gmac.io/graphql"),
      "https://tasks.gmac.io/graphql",
    );
  });
});
