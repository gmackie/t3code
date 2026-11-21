import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";

import { waitForTestFlight } from "./verify-gmacko-testflight.mjs";

const buildNumber = "202611201500";
const build = (processingState, internalBuildState) => ({
  data: [
    {
      id: "build",
      attributes: { version: buildNumber, processingState, expired: false },
      relationships: { buildBetaDetail: { data: { id: "detail" } } },
    },
  ],
  included: [{ id: "detail", type: "buildBetaDetails", attributes: { internalBuildState } }],
});

function options(responses) {
  let index = 0;
  return {
    buildNumber,
    attempts: responses.length,
    pause: async () => {},
    request: async (path) => {
      if (path.startsWith("/v1/apps?")) return { data: [{ id: "gmacko" }] };
      const params = new URL(path, "https://example.test").searchParams;
      NodeAssert.equal(params.get("filter[app]"), "gmacko");
      NodeAssert.equal(params.get("filter[version]"), buildNumber);
      NodeAssert.equal(params.get("include"), "buildBetaDetail");
      return responses[index++];
    },
  };
}

NodeTest.test("waits for the exact build to become ready for internal testing", async () => {
  const older = build("VALID", "IN_BETA_TESTING");
  older.data[0].attributes.version = "202611191500";
  NodeAssert.deepEqual(
    await waitForTestFlight(
      options([older, build("PROCESSING", "PROCESSING"), build("VALID", "READY_FOR_BETA_TESTING")]),
    ),
    { buildNumber, buildId: "build", state: "READY_FOR_BETA_TESTING" },
  );
});

NodeTest.test(
  "reports failed Apple processing and times out if processing never completes",
  async () => {
    await NodeAssert.rejects(
      waitForTestFlight(options([build("INVALID", "PROCESSING_EXCEPTION")])),
      /failed/,
    );
    await NodeAssert.rejects(
      waitForTestFlight(options([build("PROCESSING", "PROCESSING")])),
      /deadline/,
    );
  },
);
