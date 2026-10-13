# T3 Code Locked

This fork supports macOS and Linux desktop with an authenticated server bound to `127.0.0.1`. Its agent runtime is OpenCode and its source-control integration is GitLab. Remote environments, SSH device hosts, T3 Connect, cloud sign-in, account imports, outbound analytics, provider installers, sharing, and automatic application updates are removed or disabled.

Install an approved OpenCode executable and `glab` separately. The fork keeps its data under `~/.t3-locked` and uses a separate Electron profile. Select the executable under Settings → Providers, then add a local project.

Before launching the desktop application, supply these administrator-managed environment variables:

- `T3CODE_CLOUDFLARE_GATEWAY_URL`: `https://gateway.ai.cloudflare.com/v1/<32-character-account-id>/<gateway-id>/compat`.
- `T3CODE_CLOUDFLARE_MODELS`: comma-separated Workers AI IDs, such as `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The first is OpenCode's default model. Select the matching model for text generation in Settings if changing this list.
- `CLOUDFLARE_API_TOKEN`: the Workers AI token.
- `CF_AIG_TOKEN`: the token for an authenticated AI Gateway.

Supply credentials through your deployment's secret mechanism, never in source control. OpenCode remains unavailable until the gateway configuration is valid. T3's model selector uses `cloudflare-locked/<Workers-AI-ID>`; other model routes are rejected. Model requests use Cloudflare's [OpenAI-compatible Gateway endpoint](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/).

Configure `glab` for your approved GitLab host using your organization's credential procedure. No organization-specific GitLab hostname was supplied for this fork; host approval remains a deployment requirement.

Browser/device automation, local terminal/file access, arbitrary MCP servers and plugins, and scheduled tasks remain enabled. These tools can execute code and access networks independently of model routing. Deployment network controls must enforce any required egress policy. Plugin and automation tool setup may download third-party packages.

This fork has no certification claim. Certification requires the applicable checklist, approved endpoint/model inventory, signed installer review, and verification against the intended deployment. Cloudflare/GitLab credentialed workflows and Linux installer behavior must be tested in that environment.
