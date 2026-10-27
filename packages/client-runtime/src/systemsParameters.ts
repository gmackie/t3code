import type { SystemsPatchOperation, SystemsSemanticDiffResult } from "@t3tools/contracts";

/** A scalar node parameter of a system document, addressed by its JSON Pointer. */
export interface SystemsParameter {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly key: string;
  readonly pointer: string;
  readonly value: number | boolean | string;
}

/** A node's parameters; structured values are shown but only scalars can be edited. */
export interface SystemsParameterNode {
  readonly nodeId: string;
  readonly nodeType: string;
  readonly editable: ReadonlyArray<SystemsParameter>;
  readonly fixed: ReadonlyArray<{ readonly key: string; readonly json: string }>;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const escapePointer = (token: string) => token.replaceAll("~", "~0").replaceAll("/", "~1");

const isScalar = (value: unknown): value is number | boolean | string =>
  typeof value === "boolean" ||
  typeof value === "string" ||
  (typeof value === "number" && Number.isFinite(value));

/** Reads node parameters from an `sw.system` document; anything else has none. */
export function systemParameters(document: unknown): ReadonlyArray<SystemsParameterNode> {
  if (!isRecord(document) || document.format !== "sw.system" || !Array.isArray(document.nodes))
    return [];
  return document.nodes.flatMap((node: unknown, index) => {
    if (!isRecord(node) || typeof node.id !== "string" || !isRecord(node.parameters)) return [];
    const nodeId = node.id;
    const nodeType = typeof node.type === "string" ? node.type : "";
    const entries = Object.entries(node.parameters);
    return [
      {
        nodeId,
        nodeType,
        editable: entries.flatMap(([key, value]) =>
          isScalar(value)
            ? [
                {
                  nodeId,
                  nodeType,
                  key,
                  pointer: `/nodes/${index}/parameters/${escapePointer(key)}`,
                  value,
                },
              ]
            : [],
        ),
        fixed: entries.flatMap(([key, value]) =>
          isScalar(value) ? [] : [{ key, json: JSON.stringify(value) }],
        ),
      },
    ];
  });
}

/** Parses what the user typed with the type the parameter already has. */
export function parseParameterDraft(
  original: SystemsParameter["value"],
  text: string,
): { readonly value: SystemsParameter["value"] } | { readonly error: string } {
  if (typeof original === "string") return { value: text };
  if (typeof original === "boolean") {
    if (text === "true" || text === "false") return { value: text === "true" };
    return { error: "Enter true or false" };
  }
  const trimmed = text.trim();
  const value = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(value)) return { error: "Enter a finite number" };
  return { value };
}

/** Replace operations for the drafts that differ from the document; unchanged ones are dropped. */
export function parameterPatch(
  parameters: ReadonlyArray<SystemsParameter>,
  drafts: ReadonlyMap<string, SystemsParameter["value"]>,
): ReadonlyArray<SystemsPatchOperation> {
  return parameters.flatMap((parameter) => {
    const draft = drafts.get(parameter.pointer);
    return draft === undefined || draft === parameter.value
      ? []
      : [{ op: "replace" as const, path: parameter.pointer, value: draft }];
  });
}

/** One line per element kind a patch touches, e.g. `nodes changed: tank`. */
export function semanticChangeSummary(
  diff: SystemsSemanticDiffResult | undefined,
): ReadonlyArray<string> {
  if (diff === undefined) return [];
  return Object.entries(diff.changes).flatMap(([kind, changes]) =>
    (["added", "removed", "changed"] as const).flatMap((verb) =>
      changes[verb].length > 0 ? [`${kind} ${verb}: ${changes[verb].join(", ")}`] : [],
    ),
  );
}
