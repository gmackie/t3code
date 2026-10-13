/** Model routing is controlled by deployment configuration, independently of user plugin settings. */
export const LOCKED_CLOUDFLARE_PROVIDER = "cloudflare-locked";
export const DEFAULT_LOCKED_MODEL = `${LOCKED_CLOUDFLARE_PROVIDER}/workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast`;

export function lockedDownOpenCodeEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const gateway = environment.T3CODE_CLOUDFLARE_GATEWAY_URL?.trim();
  if (!gateway)
    throw new Error(
      "Set T3CODE_CLOUDFLARE_GATEWAY_URL to your approved Cloudflare AI Gateway compat endpoint.",
    );
  const url = new URL(gateway);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "gateway.ai.cloudflare.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/v1\/[a-f0-9]{32}\/[a-zA-Z0-9_-]+\/compat\/?$/.test(url.pathname)
  ) {
    throw new Error(
      "Cloudflare gateway must use https://gateway.ai.cloudflare.com/v1/<account-id>/<gateway-id>/compat.",
    );
  }
  const models = (
    environment.T3CODE_CLOUDFLARE_MODELS ?? "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast"
  )
    .split(",")
    .map((model) => model.trim());
  if (
    models.length === 0 ||
    models.some((model) => !/^workers-ai\/@cf\/[a-zA-Z0-9_./-]+$/.test(model))
  ) {
    throw new Error(
      "T3CODE_CLOUDFLARE_MODELS must contain Workers AI model IDs prefixed with workers-ai/@cf/.",
    );
  }
  const existing: unknown = JSON.parse(environment.OPENCODE_CONFIG_CONTENT ?? "{}");
  if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
    throw new Error("OPENCODE_CONFIG_CONTENT must contain an object.");
  }
  const selection = `${LOCKED_CLOUDFLARE_PROVIDER}/${models[0]}`;
  return {
    ...environment,
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    OPENCODE_DISABLE_SHARE: "true",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...existing,
      autoupdate: false,
      share: "disabled",
      enabled_providers: [LOCKED_CLOUDFLARE_PROVIDER],
      disabled_providers: [],
      model: selection,
      small_model: selection,
      provider: {
        [LOCKED_CLOUDFLARE_PROVIDER]: {
          npm: "@ai-sdk/openai-compatible",
          name: "Cloudflare Workers AI",
          options: {
            baseURL: url.toString().replace(/\/$/, ""),
            apiKey: "{env.CLOUDFLARE_API_TOKEN}",
            headers: { "cf-aig-authorization": "Bearer {env.CF_AIG_TOKEN}" },
          },
          models: Object.fromEntries(models.map((model) => [model, { name: model }])),
        },
      },
    }),
  };
}
