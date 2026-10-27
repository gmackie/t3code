import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { validatePack } from "@t3tools/systems-model/pack";

import { executeConformance } from "./conformance.ts";
import { loadFiles } from "./pack.testkit.ts";

it.layer(NodeServices.layer)("executeConformance", (it) => {
  it.effect("every discrete fixture passes; continuous ones need a solver", () =>
    Effect.gen(function* () {
      const reports = yield* executeConformance(yield* validatePack(yield* loadFiles));
      assert.deepStrictEqual(
        reports.map((report) => [report.id, report.status]),
        [
          ["DISC-001", "fail"],
          ["CHART-001", "pass"],
          ["CHART-002", "pass"],
          ["CLOCK-001", "pass"],
          ["NUM-001", "fail"],
          ["TIME-001", "pass"],
          ["TYPE-001", "pass"],
          ["GRAPH-001", "pass"],
        ],
      );
      for (const report of reports.filter((candidate) => candidate.status === "fail"))
        assert.isTrue(
          report.diagnostics.length > 0 &&
            report.diagnostics.every((diagnostic) => diagnostic.code === "E-TARGET-001"),
          report.id,
        );
    }),
  );
});
