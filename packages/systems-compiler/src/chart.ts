import { error, type ModelDiagnostic } from "@t3tools/systems-model/diagnostics";
import type { Action, ChartDocument, Expr } from "@t3tools/systems-model/documents";

import type { Domain } from "./semantics.ts";
import {
  combine,
  DIMENSIONLESS,
  isKnown,
  sameUnit,
  unitOf,
  type Unit,
  type UnitTable,
} from "./units.ts";

/**
 * Type and unit analysis of chart guards and actions (RFC-001 §4.3, §7.4). Literal
 * comparisons are dimensioned: `level >= 3` against a metre input must say `3 m`.
 * Hierarchy, references and priorities are checked by systems-model's `validateChart`.
 */

type Variable = ChartDocument["interface"]["inputs"][number];

type Inferred =
  | { readonly kind: "bool" }
  | { readonly kind: "string" }
  | { readonly kind: "number"; readonly unit: Unit };

const DOMAIN =
  /^(constant|continuous|clocked:[a-zA-Z][a-zA-Z0-9._:-]*|event:[a-zA-Z][a-zA-Z0-9._:-]*)$/;

export const parseDomain = (domain: string): Domain | undefined =>
  DOMAIN.test(domain) ? (domain as Domain) : undefined;

const describe = (inferred: Inferred) =>
  inferred.kind === "number" ? `a number in ${inferred.unit.symbol}` : `a ${inferred.kind}`;

export interface ChartScope {
  readonly units: UnitTable;
  /** Clock ids a chart may name, when it is embedded in a system. */
  readonly clocks?: ReadonlySet<string>;
}

export const checkChart = (
  chart: ChartDocument,
  file: string,
  scope: ChartScope,
): ReadonlyArray<ModelDiagnostic> => {
  const diagnostics: Array<ModelDiagnostic> = [];
  const report = (
    code: ModelDiagnostic["code"],
    message: string,
    elementId: string,
    pointer: string,
    fix?: ModelDiagnostic["fix"],
  ) =>
    diagnostics.push(
      error(code, message, { file, elementId, pointer, ...(fix === undefined ? {} : { fix }) }),
    );
  const knownUnits = Object.keys(scope.units).length > 0;
  const unit = (symbol: string | undefined) => unitOf(scope.units, symbol ?? DIMENSIONLESS);

  const variables = new Map<string, Variable>();
  for (const side of ["inputs", "outputs"] as const)
    chart.interface[side].forEach((variable, index) => {
      const at = `/interface/${side}/${index}`;
      variables.set(`${side === "inputs" ? "input" : "output"}.${variable.id}`, variable);
      if (variable.unit !== undefined && knownUnits && !isKnown(scope.units, variable.unit))
        report(
          "E-UNIT-001",
          `Unit "${variable.unit}" is not in a locked library`,
          variable.id,
          `${at}/unit`,
        );
      if (variable.domain === undefined) return;
      const domain = parseDomain(variable.domain);
      if (domain === undefined)
        report(
          "E-SCHEMA-001",
          `Domain "${variable.domain}" is not constant, continuous, clocked:<clock> or event:<type>`,
          variable.id,
          `${at}/domain`,
        );
      else if (
        domain.startsWith("clocked:") &&
        scope.clocks !== undefined &&
        !scope.clocks.has(domain.slice("clocked:".length))
      )
        report(
          "E-REF-001",
          `Domain "${domain}" names an unknown clock`,
          variable.id,
          `${at}/domain`,
        );
    });

  const typeOf = (variable: Variable): Inferred =>
    variable.type === "bool" || variable.type === "string"
      ? { kind: variable.type }
      : { kind: "number", unit: unit(variable.unit) };

  const infer = (expr: Expr, elementId: string, at: string): Inferred | undefined => {
    switch (expr.op) {
      case "literal": {
        if (typeof expr.value !== "number")
          return { kind: typeof expr.value === "boolean" ? "bool" : "string" };
        if (expr.unit !== undefined && knownUnits && !isKnown(scope.units, expr.unit)) {
          report(
            "E-UNIT-001",
            `Unit "${expr.unit}" is not in a locked library`,
            elementId,
            `${at}/unit`,
          );
          return undefined;
        }
        return { kind: "number", unit: unit(expr.unit) };
      }
      case "ref": {
        const variable = variables.get(expr.path);
        return variable === undefined ? undefined : typeOf(variable);
      }
      case "not": {
        const arg = infer(expr.arg, elementId, `${at}/arg`);
        if (arg !== undefined && arg.kind !== "bool")
          report("E-TYPE-001", `"not" needs a bool, got ${describe(arg)}`, elementId, at);
        return { kind: "bool" };
      }
      default: {
        const left = infer(expr.left, elementId, `${at}/left`);
        const right = infer(expr.right, elementId, `${at}/right`);
        if (left === undefined || right === undefined) return undefined;
        const logical = expr.op === "and" || expr.op === "or";
        const equality = expr.op === "eq" || expr.op === "ne";
        if (logical) {
          if (left.kind !== "bool" || right.kind !== "bool") {
            report(
              "E-TYPE-001",
              `"${expr.op}" needs two bools, got ${describe(left)} and ${describe(right)}`,
              elementId,
              at,
            );
            return undefined;
          }
          return { kind: "bool" };
        }
        if (left.kind !== "number" || right.kind !== "number") {
          if (!equality || left.kind !== right.kind)
            report(
              "E-TYPE-001",
              `"${expr.op}" cannot combine ${describe(left)} and ${describe(right)}`,
              elementId,
              at,
            );
          return equality ? { kind: "bool" } : undefined;
        }
        if (expr.op === "mul" || expr.op === "div")
          return {
            kind: "number",
            unit: combine(scope.units, left.unit, right.unit, expr.op === "mul" ? 1 : -1),
          };
        if (!sameUnit(left.unit, right.unit)) {
          report(
            "E-UNIT-001",
            `"${expr.op}" compares ${left.unit.symbol} with ${right.unit.symbol}`,
            elementId,
            at,
            {
              kind: "annotate-unit",
              explanation: `Write the literal or parameter in ${left.unit.symbol === DIMENSIONLESS ? right.unit.symbol : left.unit.symbol}, e.g. {"op":"literal","value":3,"unit":"${left.unit.symbol === DIMENSIONLESS ? right.unit.symbol : left.unit.symbol}"}`,
            },
          );
          return undefined;
        }
        return expr.op === "add" || expr.op === "sub" ? left : { kind: "bool" };
      }
    }
  };

  const checkActions = (
    actions: ReadonlyArray<Action> | undefined,
    elementId: string,
    at: string,
  ) =>
    actions?.forEach((action, index) => {
      if (action.op !== "assign") return;
      const target = variables.get(action.target);
      const value = infer(action.value, elementId, `${at}/${index}/value`);
      if (target === undefined || value === undefined || action.target.startsWith("input.")) return;
      const expected = typeOf(target);
      if (expected.kind !== value.kind)
        report(
          "E-TYPE-001",
          `Cannot assign ${describe(value)} to ${action.target} (${describe(expected)})`,
          elementId,
          `${at}/${index}`,
        );
      else if (
        expected.kind === "number" &&
        value.kind === "number" &&
        !sameUnit(expected.unit, value.unit)
      )
        report(
          "E-UNIT-001",
          `Cannot assign ${value.unit.symbol} to ${action.target} (${expected.unit.symbol})`,
          elementId,
          `${at}/${index}`,
        );
    });

  chart.states.forEach((state, index) => {
    checkActions(state.entry, state.id, `/states/${index}/entry`);
    checkActions(state.exit, state.id, `/states/${index}/exit`);
  });
  chart.transitions.forEach((transition, index) => {
    const at = `/transitions/${index}`;
    const trigger = transition.trigger;
    if (trigger.kind === "clock" && scope.clocks !== undefined && !scope.clocks.has(trigger.id))
      report(
        "E-REF-001",
        `Clock "${trigger.id}" is not declared by the system`,
        transition.id,
        `${at}/trigger/id`,
      );
    if (transition.guard !== undefined) {
      const guard = infer(transition.guard, transition.id, `${at}/guard`);
      if (guard !== undefined && guard.kind !== "bool")
        report(
          "E-TYPE-001",
          `A guard must be a bool, got ${describe(guard)}`,
          transition.id,
          `${at}/guard`,
        );
    }
    checkActions(transition.actions, transition.id, `${at}/actions`);
  });
  return diagnostics;
};
