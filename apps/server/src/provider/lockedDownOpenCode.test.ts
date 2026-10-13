import { describe, expect, it } from "vite-plus/test";
import { lockedDownOpenCodeEnvironment } from "./lockedDownOpenCode.ts";
const gateway =
  "https://gateway.ai.cloudflare.com/v1/0123456789abcdef0123456789abcdef/approved/compat";

describe("locked-down OpenCode model routing", () => {
  it("requires deployment configuration and rejects alternate endpoints", () => {
    expect(() => lockedDownOpenCodeEnvironment({})).toThrow("T3CODE_CLOUDFLARE_GATEWAY_URL");
    for (const endpoint of [
      "http://gateway.ai.cloudflare.com/v1/a/b/compat",
      "https://evil.example/compat",
      gateway + "?redirect=other",
      gateway.replace("gateway.ai.cloudflare.com", "gateway.ai.cloudflare.com.evil.example"),
    ]) {
      expect(() =>
        lockedDownOpenCodeEnvironment({ T3CODE_CLOUDFLARE_GATEWAY_URL: endpoint }),
      ).toThrow();
    }
  });
  it("replaces model access while retaining MCP and plugins", () => {
    const mcp = { local: { type: "local", command: ["approved-tool"] } };
    const plugin = ["approved-plugin"];
    const result = lockedDownOpenCodeEnvironment({
      T3CODE_CLOUDFLARE_GATEWAY_URL: gateway,
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        mcp,
        plugin,
        enabled_providers: ["openai"],
        provider: { openai: {} },
        model: "openai/gpt-5",
        autoupdate: true,
        share: "auto",
      }),
    });
    const config = JSON.parse(result.OPENCODE_CONFIG_CONTENT!);
    expect(config.mcp).toEqual(mcp);
    expect(config.plugin).toEqual(plugin);
    expect(config.enabled_providers).toEqual(["cloudflare-locked"]);
    expect(Object.keys(config.provider)).toEqual(["cloudflare-locked"]);
    expect(config.provider["cloudflare-locked"].options.baseURL).toBe(gateway);
    expect(config.autoupdate).toBe(false);
    expect(config.share).toBe("disabled");
    expect(result.OPENCODE_DISABLE_MODELS_FETCH).toBe("true");
  });
  it("rejects non-Workers AI model routes", () => {
    expect(() =>
      lockedDownOpenCodeEnvironment({
        T3CODE_CLOUDFLARE_GATEWAY_URL: gateway,
        T3CODE_CLOUDFLARE_MODELS: "openai/gpt-5",
      }),
    ).toThrow("Workers AI");
  });
});
