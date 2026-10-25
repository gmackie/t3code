import type { ResolvedNode } from "@t3tools/systems-compiler/compile";
import { error, type ModelDiagnostic } from "@t3tools/systems-model/diagnostics";
import type { SignalValue } from "@t3tools/systems-model/trace";

/**
 * Runtime behaviour of the standard blocks. Pure blocks are float64 functions of their
 * inputs; registers (`delay`, `counter`, `hold`) and adapters (`sample`,
 * `rate_transition`) are driven by the scheduler, which owns their state.
 */

export const PURE_BLOCKS = [
  "std.boolean_to_scalar@1",
  "std.constant@1",
  "std.gain@1",
  "std.sum2@1",
] as const;

/** Every block type the scheduler can execute. `std.unit_convert@1` needs catalog scales. */
export const SUPPORTED_BLOCKS: ReadonlyArray<string> = [
  ...PURE_BLOCKS,
  "std.counter@1",
  "std.delay@1",
  "std.hold@1",
  "std.integrator@1",
  "std.rate_transition@1",
  "std.sample@1",
  "std.statechart@1",
].toSorted();

/** A run error raised while evaluating; the scheduler turns it into the run's diagnostic. */
export class RunFault extends Error {
  readonly diagnostic: ModelDiagnostic;
  constructor(diagnostic: ModelDiagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
}

export const nonFinite = (node: string, value: number, what = "output") =>
  new RunFault(error("E-NUM-001", `Node "${node}" ${what} is ${value}`, { elementId: node }));

const number = (node: ResolvedNode, value: SignalValue | undefined) => {
  if (typeof value !== "number")
    throw new RunFault(
      error("E-TYPE-001", `Node "${node.id}" expected a number, got ${typeof value}`, {
        elementId: node.id,
      }),
    );
  return value;
};

const parameter = (node: ResolvedNode, name: string) => node.parameters[name] as SignalValue;

/** Evaluate a pure block; a non-finite result is `E-NUM-001` at that node. */
export const evaluatePure = (
  node: ResolvedNode,
  input: (port: string) => SignalValue,
): SignalValue => {
  let value: SignalValue;
  switch (node.type) {
    case "std.constant@1":
      value = parameter(node, "value");
      break;
    case "std.gain@1":
      value = number(node, parameter(node, "gain")) * number(node, input("value"));
      break;
    case "std.sum2@1":
      value = number(node, input("a")) + number(node, input("b"));
      break;
    case "std.boolean_to_scalar@1":
      value = input("value") === true ? 1 : 0;
      break;
    default:
      throw new RunFault(
        error("E-TARGET-001", `Block type ${node.type} is not a pure block`, {
          elementId: node.id,
        }),
      );
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw nonFinite(node.id, value);
  return value;
};

/** A register's value before its first tick. */
export const initialValue = (node: ResolvedNode): SignalValue | undefined =>
  node.type === "std.sample@1" ? undefined : parameter(node, "initial");
