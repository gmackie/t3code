# Skills and MCP servers

**Settings → Tools** controls what agents can use on an environment: the skills they load and the
MCP servers T3 Code gives them. Pick a project in the settings crumb to change them for that
project only. Changes apply when an agent session next starts; use **Restart agent session** in the
command palette to pick them up in an open thread.

## Skills

The **Skills** tab lists every skill the environment's agents find, grouped by where it lives: the
selected project, your personal folders (such as `~/.agents/skills` and `~/.claude/skills`), and
plugins. A skill is listed once even when several folders or agents have it.

Turning a skill off removes it from the composer's skill menu and hides it from Claude, Codex and
OpenCode 1.x sessions. Cursor, Grok, Antigravity, Pi, Muse and OpenCode 2 have no way to hide one skill,
so they may still use it on their own. A skill switched off in the agent's own settings shows as
off and can't be turned on here.

With a project selected, a switch overrides the environment for that project only: you can turn a
skill off for one project, or back on where the environment has it off.

## MCP servers

The **MCP servers** tab lists servers T3 Code adds to supported agent sessions, next to its own
`t3-code` server and the servers each agent already loads from its own config, which keep working
unchanged. T3 Code never edits those config files.

**Add server** takes a command (such as `npx -y @playwright/mcp`) or a URL. Pasting the JSON
snippet from a server's documentation fills in the form. Environment variables and headers are
marked secret by default: secret values are stored on the environment and never shown again, so
leave the field empty to keep one or type a new value to replace it. Adding or editing a server
needs permission to manage providers, because a server runs on the environment for every agent.

### Servers that sign in with OAuth

Hosted servers such as Linear, Sentry or ForgeGraph sign you in with your account instead of a key.
Turn on **Sign in with OAuth** for a URL server (pasting a snippet that gives only a URL turns it on
for you), save, then use **Sign in** on its row. Your browser opens the server's sign-in page and
returns to T3 Code when you approve. The environment keeps the sign-in and refreshes it, so every
agent session on that environment uses the account you signed in with; agents never see the token.
If a refresh stops working the row shows **Reconnect**, and **Sign out** removes access.

The sign-in page returns to the address your client uses to reach the environment. Some servers only
accept `https` or `localhost` return addresses, so on a plain-http remote connection sign in from
the desktop app on that machine, or over an `https` address. A project that points the server at a
different URL signs in separately.

With a project selected, servers you add belong to that project. Giving one the same name as an
environment server replaces it for the project, which is how to point a project at a different
account. Inherited servers can be switched off for the project without removing them elsewhere.

Claude, Codex, Cursor, OpenCode, Grok and other ACP agents get these servers. ACP agents that don't
support URL servers only get command servers. Pi and Muse aren't supported yet. OpenCode 1
connections using an external server URL don't receive these servers: that server retains dynamic
configuration after the T3 session ends. Configure MCP in that external server directly.

## Plugins

A plugin is an MCP server packaged with views. Install one in **Settings → Plugins → MCP plugins**
from a folder on the environment that contains a `t3-plugin.json`. Its server then appears under
**MCP servers** as "From plugin …", so agents get its tools like any other server. You can switch it
off there, or for one project, but its settings live with the plugin: use **Configure** on the
plugin to set its variables, such as an API token. Installing needs permission to manage providers.

A plugin's panels open in the right panel beside a thread, from the command palette. A thread panel
follows you as you switch threads; a project panel shows the project as a whole. A panel can call
its own plugin's tools without asking, because installing the plugin allowed that; disable or
uninstall the plugin to stop it. If the plugin's server needs you to sign in, the panel says so
instead of loading.

On mobile, open **Plugin panels** from a thread's header, or choose a project in
**Settings → Projects** to open its project panels without a thread. Panels use the plugins
installed on that project's connected environment. If a panel asks you to sign in, complete the
sign-in in your browser and return to T3 Code. Installation and configuration stay on the server.
