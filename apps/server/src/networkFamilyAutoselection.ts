import * as NodeNet from "node:net";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * Per-address budget for Node's Happy Eyeballs (`autoSelectFamily`).
 *
 * Node's default is 250 ms. On a network that advertises IPv6 but cannot route
 * it, the IPv6 attempt eats that budget and the IPv4 attempt that follows can be
 * cut off too, so roughly one outbound request in three timed out while curl
 * succeeded. 2000 ms measured reliable on such a network and still sits well
 * under any request timeout. Healthy networks are unaffected: the first address
 * that connects wins immediately, so the budget only matters when one fails.
 */
export const DEFAULT_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS = 2_000;

export const NETWORK_FAMILY_ATTEMPT_TIMEOUT_ENV = "T3CODE_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS";

const NODE_FLAG = "--network-family-autoselection-attempt-timeout";
// Node clamps anything lower to 10 ms.
const NODE_MINIMUM_MS = 10;

export interface NetworkFamilyAttemptTimeoutInput {
  readonly envOverride: string | undefined;
  readonly nodeOptions: string | undefined;
  readonly execArgv: ReadonlyArray<string>;
  readonly currentDefaultMs: number;
}

export interface NetworkFamilyAttemptTimeoutDecision {
  /** Timeout to pass to `net.setDefaultAutoSelectFamilyAttemptTimeout`, or null to leave Node's. */
  readonly timeoutMs: number | null;
  /** The env override, when it was set but not a usable value. */
  readonly invalidOverride: string | null;
}

const hasExplicitNodeFlag = (args: ReadonlyArray<string>) =>
  args.some((arg) => {
    // Node accepts underscores in place of dashes in option names.
    const name = arg.split("=", 1)[0]!.replaceAll("_", "-");
    return name === NODE_FLAG;
  });

const parseOverride = (value: string) => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= NODE_MINIMUM_MS ? parsed : null;
};

/**
 * Decides the Happy Eyeballs per-address timeout. A valid env override wins; an
 * explicit Node flag in execArgv or NODE_OPTIONS is otherwise left alone; else
 * the default is raised to {@link DEFAULT_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS}
 * unless it is already at least that.
 */
export function resolveNetworkFamilyAttemptTimeout(
  input: NetworkFamilyAttemptTimeoutInput,
): NetworkFamilyAttemptTimeoutDecision {
  let invalidOverride: string | null = null;
  if (input.envOverride !== undefined && input.envOverride.trim() !== "") {
    const override = parseOverride(input.envOverride);
    if (override !== null) {
      return { timeoutMs: override === input.currentDefaultMs ? null : override, invalidOverride };
    }
    invalidOverride = input.envOverride;
  }
  const nodeOptions = input.nodeOptions?.split(/\s+/).filter(Boolean) ?? [];
  if (hasExplicitNodeFlag(input.execArgv) || hasExplicitNodeFlag(nodeOptions)) {
    return { timeoutMs: null, invalidOverride };
  }
  return {
    timeoutMs:
      input.currentDefaultMs >= DEFAULT_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS
        ? null
        : DEFAULT_NETWORK_FAMILY_ATTEMPT_TIMEOUT_MS,
    invalidOverride,
  };
}

const optionalString = (name: string) =>
  Config.String(name).pipe(Config.option, Config.map(Option.getOrUndefined));

/** Applies the decision once for this process. Run before the server makes outbound requests. */
export const configureNetworkFamilyAutoselection = Effect.gen(function* () {
  const envOverride = yield* optionalString(NETWORK_FAMILY_ATTEMPT_TIMEOUT_ENV);
  const nodeOptions = yield* optionalString("NODE_OPTIONS");
  const decision = resolveNetworkFamilyAttemptTimeout({
    envOverride,
    nodeOptions,
    execArgv: process.execArgv,
    currentDefaultMs: NodeNet.getDefaultAutoSelectFamilyAttemptTimeout(),
  });
  if (decision.invalidOverride !== null) {
    yield* Effect.logWarning(
      `Ignoring ${NETWORK_FAMILY_ATTEMPT_TIMEOUT_ENV}: expected a whole number of milliseconds of at least ${NODE_MINIMUM_MS}.`,
      { value: decision.invalidOverride },
    );
  }
  if (decision.timeoutMs !== null) {
    NodeNet.setDefaultAutoSelectFamilyAttemptTimeout(decision.timeoutMs);
  }
}).pipe(Effect.orElseSucceed(() => undefined));
