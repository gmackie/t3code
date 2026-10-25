import { error } from "@t3tools/systems-model/diagnostics";
import type { RunDocument } from "@t3tools/systems-model/documents";
import {
  add,
  ceil,
  divide,
  multiply,
  subtract,
  toNumber,
  type RationalTime,
} from "@t3tools/systems-model/rational";

import { nonFinite, RunFault } from "./blocks.ts";

/**
 * P0 explicit ODE solvers (RFC-001 §8.2) with pinned identities. Each call integrates one
 * barrier-free interval and lands exactly on its end: a step that would cross the barrier
 * is shortened. Step positions are multiples of ulp(interval) so they sum to the interval
 * exactly, and increments are compensated sums, so a constant slope integrates exactly.
 */

export const SOLVER_METHODS = ["rk4-fixed@1", "rk45-dopri5@1"] as const;

export type SolverSettings = RunDocument["solver"];

export interface OdeProblem {
  /** Integrator node ids, in state-vector order. */
  readonly states: ReadonlyArray<string>;
  /** `dx/dt` at `(t, y)`. Pure: called at stage points and for rejected steps. */
  readonly derivative: (t: number, y: Float64Array) => Float64Array;
}

export interface StepBudget {
  /** Solver steps (accepted or rejected) still allowed in this run. */
  remaining: number;
}

export interface Advanced {
  readonly y: Float64Array;
  readonly steps: number;
  readonly rejected: number;
}

export const DEFAULT_ABS_TOL = 1e-6;
export const DEFAULT_REL_TOL = 1e-3;

const spend = (budget: StepBudget, at: number) => {
  if (budget.remaining <= 0)
    throw new RunFault(
      error("E-NUM-002", `Solver step limit reached at t≈${at}`, { elementId: "solver" }),
    );
  budget.remaining--;
};

const checkFinite = (problem: OdeProblem, y: Float64Array, at: number) => {
  for (let index = 0; index < y.length; index++)
    if (!Number.isFinite(y[index]!))
      throw nonFinite(problem.states[index]!, y[index]!, `state at t≈${at}`);
};

/** The spacing of float64 values at `length`; every multiple of it up to `length` is exact. */
const quantumOf = (length: number) => {
  let quantum = 2 ** (Math.floor(Math.log2(length)) - 52);
  while (length / quantum >= 2 ** 53) quantum *= 2;
  while (length / quantum < 2 ** 52) quantum /= 2;
  return quantum;
};

/** Stage input `y + h Σ a_j k_j`. */
const stage = (y: Float64Array, h: number, a: ReadonlyArray<number>, k: Float64Array[]) => {
  const out = Float64Array.from(y);
  a.forEach((coefficient, j) => {
    if (coefficient !== 0)
      for (let i = 0; i < out.length; i++) out[i]! += h * coefficient * k[j]![i]!;
  });
  return out;
};

/** `Σ w_j k_j` for weights summing to `total`, written as `total·k1 + Σ w_j (k_j − k1)`. */
const slope = (k: Float64Array[], weights: ReadonlyArray<number>, total: 0 | 1) => {
  const k1 = k[0]!;
  const out = Float64Array.from(k1, (value) => total * value);
  weights.forEach((weight, j) => {
    if (j > 0 && weight !== 0)
      for (let i = 0; i < out.length; i++) out[i]! += weight * (k[j]![i]! - k1[i]!);
  });
  return out;
};

/** Kahan-compensated running sum of the increments since the interval start. */
interface Sum {
  readonly total: Float64Array;
  readonly carry: Float64Array;
}

const accumulate = (sum: Sum, h: number, phi: Float64Array): Sum => {
  const total = Float64Array.from(sum.total);
  const carry = Float64Array.from(sum.carry);
  for (let i = 0; i < total.length; i++) {
    const term = h * phi[i]! - carry[i]!;
    const next = total[i]! + term;
    carry[i] = next - total[i]! - term;
    total[i] = next;
  }
  return { total, carry };
};

const valueAt = (y0: Float64Array, sum: Sum) => y0.map((value, i) => value + sum.total[i]!);

const RK4_WEIGHTS = [1 / 6, 1 / 3, 1 / 3, 1 / 6];

/** `rk4-fixed@1`: steps of `fixedStep` from the interval start, the last one shortened. */
const rk4 = (
  problem: OdeProblem,
  y0: Float64Array,
  from: RationalTime,
  to: RationalTime,
  fixedStep: RationalTime,
  budget: StepBudget,
): Advanced => {
  const start = toNumber(from);
  const quantum = quantumOf(toNumber(subtract(to, from)));
  const position = (time: RationalTime) =>
    Math.round(toNumber(subtract(time, from)) / quantum) * quantum;
  const count = ceil(divide(subtract(to, from), fixedStep));
  let sum: Sum = { total: new Float64Array(y0.length), carry: new Float64Array(y0.length) };
  let y = y0;
  let tau = 0;
  for (let index = 1n; index <= count; index++) {
    const next = position(index === count ? to : add(from, multiply(fixedStep, index)));
    const h = next - tau;
    const t = start + tau;
    spend(budget, t);
    const k1 = problem.derivative(t, y);
    const k2 = problem.derivative(t + h / 2, stage(y, h, [1 / 2], [k1]));
    const k3 = problem.derivative(t + h / 2, stage(y, h, [0, 1 / 2], [k1, k2]));
    const k4 = problem.derivative(t + h, stage(y, h, [0, 0, 1], [k1, k2, k3]));
    sum = accumulate(sum, h, slope([k1, k2, k3, k4], RK4_WEIGHTS, 1));
    y = valueAt(y0, sum);
    checkFinite(problem, y, start + next);
    tau = next;
  }
  return { y, steps: Number(count), rejected: 0 };
};

// Dormand–Prince 5(4): Butcher tableau; row 7 is the 5th-order solution (FSAL).
const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const A: ReadonlyArray<ReadonlyArray<number>> = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
/** 5th- minus 4th-order weights; they sum to zero. */
const E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];

const scaledNorm = (
  v: Float64Array,
  y: Float64Array,
  z: Float64Array,
  absTol: number,
  relTol: number,
) => {
  let sum = 0;
  for (let i = 0; i < v.length; i++) {
    const scale = absTol + relTol * Math.max(Math.abs(y[i]!), Math.abs(z[i]!));
    sum += (v[i]! / scale) ** 2;
  }
  return Math.sqrt(sum / Math.max(1, v.length));
};

/** Hairer–Nørsett–Wanner starting step for a 5th-order method. */
const initialStep = (
  problem: OdeProblem,
  t: number,
  y: Float64Array,
  f0: Float64Array,
  absTol: number,
  relTol: number,
) => {
  const d0 = scaledNorm(y, y, y, absTol, relTol);
  const d1 = scaledNorm(f0, y, y, absTol, relTol);
  const h0 = d0 < 1e-5 || d1 < 1e-5 ? 1e-6 : (0.01 * d0) / d1;
  const f1 = problem.derivative(t + h0, stage(y, h0, [1], [f0]));
  const d2 = scaledNorm(slope([f0, f1], [0, 1], 0), y, y, absTol, relTol) / h0;
  const largest = Math.max(d1, d2);
  return Math.min(
    100 * h0,
    largest <= 1e-15 ? Math.max(1e-6, h0 * 1e-3) : (0.01 / largest) ** (1 / 5),
  );
};

/**
 * `rk45-dopri5@1`: adaptive Dormand–Prince 5(4), error `‖e / (absTol + relTol·max|y|)‖_rms ≤ 1`,
 * step factor `0.9·err^(-1/5)` clamped to [0.2, 5]. `fixedStep`, when given, is the initial step.
 */
const dopri5 = (
  problem: OdeProblem,
  y0: Float64Array,
  from: RationalTime,
  to: RationalTime,
  settings: SolverSettings,
  budget: StepBudget,
): Advanced => {
  const absTol = settings.absTol ?? DEFAULT_ABS_TOL;
  const relTol = settings.relTol ?? DEFAULT_REL_TOL;
  const start = toNumber(from);
  const length = toNumber(subtract(to, from));
  const quantum = quantumOf(length);
  let sum: Sum = { total: new Float64Array(y0.length), carry: new Float64Array(y0.length) };
  let y = y0;
  let tau = 0;
  let k1 = problem.derivative(start, y);
  let h =
    settings.fixedStep === undefined
      ? initialStep(problem, start, y, k1, absTol, relTol)
      : toNumber(settings.fixedStep);
  let steps = 0;
  let rejected = 0;
  for (;;) {
    // Land exactly on the barrier rather than leave a sliver of the interval behind.
    const proposed = tau + Math.max(quantum, Math.round(h / quantum) * quantum);
    const last = h >= (length - tau) * (1 - 1e-10) || proposed >= length;
    const next = last ? length : proposed;
    h = next - tau;
    const t = start + tau;
    if (h <= 16 * Number.EPSILON * Math.max(1, Math.abs(t)) && !last)
      throw new RunFault(
        error("E-NUM-002", `Step size underflow at t≈${t} (h=${h})`, {
          elementId: problem.states[0]!,
        }),
      );
    spend(budget, t);
    const k = [k1];
    for (let row = 1; row < 7; row++)
      k.push(problem.derivative(t + C[row]! * h, stage(y, h, A[row]!, k)));
    const candidate = accumulate(sum, h, slope(k, A[6]!, 1));
    const value = valueAt(y0, candidate);
    const estimate = slope(k, E, 0).map((e) => h * e);
    const err = scaledNorm(estimate, y, value, absTol, relTol);
    const factor = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * err ** (-1 / 5)));
    if (!(err <= 1)) {
      checkFinite(problem, value, t + h);
      rejected++;
      h *= Math.min(1, factor);
      continue;
    }
    checkFinite(problem, value, t + h);
    steps++;
    sum = candidate;
    y = value;
    k1 = k[6]!;
    tau = next;
    if (last) return { y, steps, rejected };
    h *= factor;
  }
};

/** Integrate `problem` over `[from, to]` with the run's solver. */
export const integrate = (
  problem: OdeProblem,
  y0: Float64Array,
  from: RationalTime,
  to: RationalTime,
  settings: SolverSettings,
  budget: StepBudget,
): Advanced => {
  checkFinite(problem, y0, toNumber(from));
  switch (settings.method) {
    case "rk4-fixed@1":
      if (settings.fixedStep === undefined)
        throw new RunFault(error("E-SCHEMA-001", "rk4-fixed@1 needs solver.fixedStep"));
      return rk4(problem, y0, from, to, settings.fixedStep, budget);
    case "rk45-dopri5@1":
      return dopri5(problem, y0, from, to, settings, budget);
    case "none":
      throw new RunFault(
        error("E-TARGET-001", "The model has continuous states but the run names no solver"),
      );
  }
};
