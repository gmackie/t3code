import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { validatePack } from "@t3tools/systems-model/pack";

import { executeConformance } from "./conformance.ts";
import { loadFiles } from "./pack.testkit.ts";

it.layer(NodeServices.layer)("executeConformance", (it) => {
  it.effect("every manifest fixture passes", () =>
    Effect.gen(function* () {
      const reports = yield* executeConformance(yield* validatePack(yield* loadFiles));
      assert.deepStrictEqual(
        reports.map((report) => [report.id, report.status, report.mismatches]),
        [
          "DISC-001",
          "CHART-001",
          "CHART-002",
          "CLOCK-001",
          "NUM-001",
          "TIME-001",
          "TYPE-001",
          "GRAPH-001",
        ].map((id) => [id, "pass", []]),
      );
      const time = reports.find((report) => report.id === "TIME-001")!;
      assert.deepStrictEqual(
        time.diagnostics.map((diagnostic) => diagnostic.code),
        ["E-TIME-002"],
      );
    }),
  );
});
