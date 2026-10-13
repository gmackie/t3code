# T3 Code Locked

A separate desktop fork of T3 Code for macOS and Linux, based on main at `451d600e`.

- OpenCode with Workers AI through Cloudflare AI Gateway.
- Authenticated local server bound to loopback.
- Git and GitLab integration.
- Browser/device automation, MCP/plugins, and scheduled tasks retained.
- Remote environments, SSH device hosts, cloud sign-in, other provider runtimes and integrations, outbound analytics, automatic updates, and provider installers removed or disabled.

See [setup and deployment requirements](docs/user/locked-down.md). Approved gateway/model configuration and credentials are required before OpenCode can run. This fork has no certification claim.

The desktop app and data directories are separate from a standard T3 Code install. Development still uses the repository's Vite Plus workspace tooling; install with `vp install`, build the server with `vp run --filter t3 build:bundle`, then build the web and desktop bundles using their package build configuration. Release installers require the usual platform build tools and signing setup.

Upstream source: [T3 Code](https://github.com/pingdotgg/t3code). MIT licensed; original attribution is preserved in [LICENSE](LICENSE).
