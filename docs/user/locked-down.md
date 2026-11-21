# T3 Code Locked

The `lockdown` branch builds T3 Code Locked, a macOS and Linux desktop app for environments that must not leak data. Its agent runtime is a local OpenCode whose models go through your Cloudflare AI Gateway, and its source control is your GitLab.

The branch keeps upstream's code and turns the edition on with one constant, `LOCKDOWN_EDITION` in `packages/shared/src/lockdownEdition.ts`. Guards at a few choke points read it, so the daily merge of `main` stays small.

## What the locked edition enforces

- **A built-in managed policy.** It applies whether or not an administrator deploys one, and an administrator's policy can only narrow it. Under it:
  - Only this machine can connect: the server binds to loopback, and LAN access, Tailscale Serve, pairing links and T3 Connect are off.
  - Product analytics, webhook tasks and browser cookie import are off.
  - OpenCode is the only provider.
  - Desktop, server and provider updates are off.
  - Locked settings turn off provider update checks (npm and the remote model manifest), linked environments and guest sharing. OTLP export is always off.
- **An in-process egress guard.** Every `fetch` and undici request from the server and the desktop main process may reach only loopback and the hosts in `T3CODE_LOCKDOWN_ALLOWED_HOSTS`, over https.
- **A loopback-only renderer CSP.** The renderer cannot load Clerk, the Cloudflare challenge script, remote images, theme search or remote environments.
- **No cloud configuration in the web app.** It has no Clerk, relay or relay tracing, whatever the build environment sets.
- **GitLab only.** It is the only source-control driver the server constructs.
- **No remote environments.** SSH environments are disabled in the desktop app.
- **No voice, usage meters or standalone trackers.** Dictation (cloud transcription, downloaded speech models and Apple Speech), OpenCode usage limits (which read your opencode.ai account) and Linear are off. Preview tunnels to other devices are off.
- **A locked OpenCode.** It always runs as its own local process, never at a server URL. It runs without auto-update, models.dev fetches or sharing, and with your gateway as its only enabled provider. Session, turn, fork, compaction and text-generation requests for other models are rejected.
- **A separate identity.** The app ID is `com.t3tools.t3code.locked`, the protocol is `t3code-locked://`, data lives under `~/.t3-locked`, the Electron profile is `t3code-locked`, and there is no update feed.

## Deployment configuration

Before launching, set these through your deployment's secret mechanism, never in source control:

- `T3CODE_CLOUDFLARE_GATEWAY_URL`: `https://gateway.ai.cloudflare.com/v1/<32-character-account-id>/<gateway-id>/compat`.
- `T3CODE_CLOUDFLARE_MODELS`: comma-separated Workers AI IDs, such as `workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The first is OpenCode's default. T3 shows them as `cloudflare-locked/<Workers AI ID>`.
- `CLOUDFLARE_API_TOKEN`: the Workers AI token.
- `CF_AIG_TOKEN`: the token for an authenticated AI Gateway.
- `T3CODE_LOCKDOWN_ALLOWED_HOSTS`: comma-separated host names that in-process requests may reach, such as your GitLab host. `glab` runs as its own process and is not limited by this list.
- `GITLAB_HOST`: your GitLab host. Without it, `glab` defaults to gitlab.com.

OpenCode stays unavailable until the gateway configuration is valid. Install an approved `opencode` and `glab`, configure `glab` for your GitLab host, enable OpenCode under Settings → Providers, then add a local project.

## What it does not control

These features remain enabled, as requested in T3CODE-15:

- browser and device automation
- the local terminal and file access
- arbitrary MCP servers and plugins
- scheduled tasks

They run their own processes, which can reach the network independently of the egress guard and of model routing. The same is true of OpenCode's own tools, `git` and `glab`.

Projects and agents can also clone from any git URL. If you need egress limits for any of these, enforce them with your deployment's network controls.

This edition has no certification claim.
