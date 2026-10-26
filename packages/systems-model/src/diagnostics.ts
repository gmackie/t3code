import * as Schema from "effect/Schema";

/** RFC-001 §10 diagnostic classes. Codes are a stable contract for agents and fixtures. */
export const DiagnosticCode = Schema.Literals([
  "E-SCHEMA-001",
  "E-REF-001",
  "E-TYPE-001",
  "E-UNIT-001",
  "E-CLOCK-001",
  "E-ALG-001",
  "E-CHART-001",
  "E-CHART-002",
  "E-TIME-001",
  "E-TIME-002",
  "E-NUM-001",
  "E-NUM-002",
  "E-TARGET-001",
  "E-REPLAY-001",
  "E-AUTH-001",
]);
export type DiagnosticCode = typeof DiagnosticCode.Type;

export const DiagnosticStage = Schema.Literals([
  "parse",
  "resolve",
  "typecheck",
  "clock",
  "causality",
  "chart",
  "lower",
  "run",
]);
export type DiagnosticStage = typeof DiagnosticStage.Type;

const Location = Schema.Struct({
  file: Schema.optionalKey(Schema.String),
  elementId: Schema.optionalKey(Schema.String),
  /** JSON Pointer into the semantic source. */
  pointer: Schema.optionalKey(Schema.String),
});

export const ModelDiagnostic = Schema.Struct({
  code: DiagnosticCode,
  severity: Schema.Literals(["error", "warning", "info"]),
  stage: DiagnosticStage,
  file: Schema.optionalKey(Schema.String),
  elementId: Schema.optionalKey(Schema.String),
  pointer: Schema.optionalKey(Schema.String),
  message: Schema.String,
  related: Schema.optionalKey(Schema.Array(Location)),
  /** A suggestion an agent or GUI may propose; never applied automatically. */
  fix: Schema.optionalKey(Schema.Struct({ kind: Schema.String, explanation: Schema.String })),
});
export type ModelDiagnostic = typeof ModelDiagnostic.Type;

const STAGE: Record<DiagnosticCode, DiagnosticStage> = {
  "E-SCHEMA-001": "parse",
  "E-REF-001": "resolve",
  "E-TYPE-001": "typecheck",
  "E-UNIT-001": "typecheck",
  "E-CLOCK-001": "clock",
  "E-ALG-001": "causality",
  "E-CHART-001": "chart",
  "E-CHART-002": "chart",
  "E-TIME-001": "typecheck",
  "E-TIME-002": "run",
  "E-NUM-001": "run",
  "E-NUM-002": "run",
  "E-TARGET-001": "lower",
  "E-REPLAY-001": "run",
  "E-AUTH-001": "resolve",
};

export const error = (
  code: DiagnosticCode,
  message: string,
  location: Omit<ModelDiagnostic, "code" | "severity" | "stage" | "message"> = {},
): ModelDiagnostic => ({ code, severity: "error", stage: STAGE[code], message, ...location });

export const hasErrors = (diagnostics: ReadonlyArray<ModelDiagnostic>): boolean =>
  diagnostics.some((diagnostic) => diagnostic.severity === "error");

const key = (d: ModelDiagnostic) => [
  d.code,
  d.elementId ?? "",
  d.message,
  d.file ?? "",
  d.pointer ?? "",
];

/** Order by code and element id, so output never depends on declaration or iteration order. */
export const sortDiagnostics = (
  diagnostics: ReadonlyArray<ModelDiagnostic>,
): ReadonlyArray<ModelDiagnostic> =>
  diagnostics.toSorted((a, b) => {
    const left = key(a);
    const right = key(b);
    for (let index = 0; index < left.length; index++) {
      if (left[index]! < right[index]!) return -1;
      if (left[index]! > right[index]!) return 1;
    }
    return 0;
  });
