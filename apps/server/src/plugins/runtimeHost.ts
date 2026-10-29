// @effect-diagnostics globalFetch:off - attached plugin endpoints are an explicit server boundary.
// @effect-diagnostics globalTimers:off - plugin request deadlines are cleared on every completion path.
import * as Schema from "effect/Schema";
import {
  PLUGIN_COMPOSER_REVIEW_HOOK,
  PLUGIN_COMPOSER_REVIEW_TIMEOUT_MS,
  PluginComposerReviewVerdict,
  PluginSurfaceModel,
  PluginActionInput,
  PluginActionResult,
  PluginPanelGetInput,
  PluginPanelModel,
  PluginWorkflowGetInput,
  PluginWorkflowActionInput,
  PluginWorkflowModel,
  type PluginComposerReviewDecisionInput,
  type PluginComposerReviewInput,
  type PluginComposerReviewResult,
  type PluginHealth,
  type PluginManifest,
  type PluginSurfaceGetInput as PluginSurfaceGetInputType,
  type PluginSurfaceModel as PluginSurfaceModelType,
} from "@t3tools/contracts";

import { PluginLifecycle } from "./lifecycle.ts";
import { PluginRuntimeSupervisor } from "./runtimeSupervisor.ts";

const decodePluginSurfaceModel = Schema.decodeUnknownSync(PluginSurfaceModel);
const decodePluginPanelModel = Schema.decodeUnknownSync(PluginPanelModel);
const decodePluginWorkflowModel = Schema.decodeUnknownSync(PluginWorkflowModel);
const decodePluginActionResult = Schema.decodeUnknownSync(PluginActionResult);
const decodePluginComposerReviewVerdict = Schema.decodeUnknownSync(PluginComposerReviewVerdict);

const COMPOSER_REVIEW_PASS: PluginComposerReviewResult = { verdict: "pass" };

type PluginRuntimeHostOptions = {
  /** Per-plugin budget for `composer.review`; slower plugins count as a pass. */
  readonly composerReviewTimeoutMs?: number;
};

/** A plugin reviews drafts only when it both requests the capability and opts into the hook. */
function isComposerReviewer(manifest: PluginManifest): boolean {
  return (
    manifest.capabilities.some((capability) => capability.kind === "composer.review") &&
    (manifest.contributes.hooks ?? []).includes(PLUGIN_COMPOSER_REVIEW_HOOK)
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`plugin request timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class PluginRuntimeHost {
  readonly #lifecycle: PluginLifecycle;
  readonly #supervisor: PluginRuntimeSupervisor;
  readonly #composerReviewTimeoutMs: number;
  #nextRequestId = 1;

  constructor(
    lifecycle: PluginLifecycle,
    supervisor: PluginRuntimeSupervisor,
    options: PluginRuntimeHostOptions = {},
  ) {
    this.#lifecycle = lifecycle;
    this.#supervisor = supervisor;
    this.#composerReviewTimeoutMs =
      options.composerReviewTimeoutMs ?? PLUGIN_COMPOSER_REVIEW_TIMEOUT_MS;
  }

  async enable(pluginId: string): Promise<PluginHealth> {
    const plugin = this.#plugin(pluginId);
    this.#lifecycle.enable(pluginId);
    if (plugin.manifest.runtime.kind !== "managed-app") return this.#lifecycle.health(pluginId);
    try {
      return await this.#supervisor.start(
        pluginId,
        plugin.manifest.runtime.command,
        plugin.directory,
      );
    } catch (error) {
      this.#lifecycle.disable(pluginId);
      await this.#supervisor.stop(pluginId);
      throw error;
    }
  }

  async disable(pluginId: string): Promise<PluginHealth> {
    const plugin = this.#plugin(pluginId);
    if (plugin.manifest.runtime.kind === "managed-app") await this.#supervisor.stop(pluginId);
    this.#lifecycle.disable(pluginId);
    return this.#lifecycle.health(pluginId);
  }

  health(pluginId: string): PluginHealth {
    const plugin = this.#plugin(pluginId);
    return plugin.manifest.runtime.kind === "managed-app"
      ? this.#supervisor.health(pluginId)
      : this.#lifecycle.health(pluginId);
  }

  async surface(input: PluginSurfaceGetInputType): Promise<PluginSurfaceModelType> {
    return decodePluginSurfaceModel(
      await this.#request(input.pluginId, "surface.get", input, "surface"),
    );
  }

  async panel(input: PluginPanelGetInput): Promise<PluginPanelModel> {
    return decodePluginPanelModel(await this.#request(input.pluginId, "panel.get", input, "panel"));
  }

  async workflow(input: PluginWorkflowGetInput): Promise<PluginWorkflowModel> {
    return decodePluginWorkflowModel(
      await this.#request(input.pluginId, "workflow.get", input, "workflow"),
    );
  }

  async workflowAction(input: PluginWorkflowActionInput): Promise<PluginActionResult> {
    return decodePluginActionResult(
      await this.#request(input.pluginId, "action.execute", input, "action"),
    );
  }

  async action(input: PluginActionInput): Promise<PluginActionResult> {
    return decodePluginActionResult(
      await this.#request(input.pluginId, "action.execute", input, "action"),
    );
  }

  /**
   * Fans a draft out to every running composer reviewer. Never rejects: errors,
   * timeouts and malformed verdicts count as a pass. Reviewers are asked in
   * parallel and the first suggestion in install order wins.
   */
  async composerReview(input: PluginComposerReviewInput): Promise<PluginComposerReviewResult> {
    const reviewers = this.#composerReviewers();
    if (reviewers.length === 0) return COMPOSER_REVIEW_PASS;
    const verdicts = await Promise.all(
      reviewers.map(async (pluginId) => {
        try {
          const verdict = decodePluginComposerReviewVerdict(
            await withTimeout(
              this.#request(pluginId, "composer.review", input, "composer-review"),
              this.#composerReviewTimeoutMs,
            ),
          );
          return { pluginId, verdict };
        } catch {
          return { pluginId, verdict: COMPOSER_REVIEW_PASS };
        }
      }),
    );
    for (const { pluginId, verdict } of verdicts) {
      if (verdict.verdict !== "suggest") continue;
      if (verdict.tips.length === 0 && verdict.rewrite === undefined) continue;
      return { ...verdict, pluginId };
    }
    return COMPOSER_REVIEW_PASS;
  }

  /** Tells the reviewing plugin what the user did with its suggestion. Never rejects. */
  async composerReviewDecision(input: PluginComposerReviewDecisionInput): Promise<void> {
    if (!this.#composerReviewers().includes(input.pluginId)) return;
    try {
      await withTimeout(
        this.#request(input.pluginId, "composer.reviewDecision", input, "composer-review-decision"),
        this.#composerReviewTimeoutMs,
      );
    } catch {
      // Decisions are telemetry for the plugin; a failure changes nothing for the user.
    }
  }

  #composerReviewers(): string[] {
    return this.#lifecycle
      .snapshot()
      .filter(
        (plugin) =>
          plugin.state === "healthy" &&
          plugin.grants.some((grant) => grant.kind === "composer.review") &&
          isComposerReviewer(plugin.manifest),
      )
      .map((plugin) => plugin.manifest.id)
      .filter((pluginId) => this.health(pluginId).state === "healthy");
  }

  async #request(
    pluginId: string,
    method: string,
    payload: unknown,
    path: string,
  ): Promise<unknown> {
    const plugin = this.#plugin(pluginId);
    if (plugin.manifest.runtime.kind === "managed-app") {
      const response = await this.#supervisor.request(pluginId, {
        type: "plugin.request",
        requestId: `${pluginId}:${this.#nextRequestId++}`,
        method,
        payload,
      });
      if (!response.ok) throw new Error(response.error);
      return response.result;
    }
    const endpoint = `${plugin.manifest.runtime.endpoint.replace(/\/$/u, "")}/${path}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`plugin ${path} request failed: ${response.status}`);
    return response.json();
  }

  #plugin(pluginId: string) {
    const plugin = this.#lifecycle.snapshot().find((entry) => entry.manifest.id === pluginId);
    if (!plugin) throw new Error(`plugin not installed: ${pluginId}`);
    return plugin;
  }
}
