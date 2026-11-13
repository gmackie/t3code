# Nightly conflict sessions

When the daily upstream merge conflicts, GMACKO Nightly aborts the CI merge and
calls the T3 Code MCP server on gmacko-mini to start a resolution thread in a
worktree. The release stays blocked until the resulting PR passes checks and
merges. A clean merge follows the existing release path.

Register the T3 Code checkout as a project on gmacko-mini. In the Forgejo
`gmackie/t3code` repository's Actions configuration, set:

- Variable `T3_CONFLICT_MCP_URL`: that environment's HTTPS MCP URL, reachable
  from the `forgegraph-ci` runner.
- Optional variable `T3_CONFLICT_MCP_IP`: the Mini’s stable tailnet IP, used
  as a per-container hosts entry when the runner cannot resolve MagicDNS.
- Variable `T3_CONFLICT_PROJECT_ID`: the registered T3 Code project ID.
- Secret `T3_CONFLICT_MCP_TOKEN`: an authenticated MCP credential with access
  to that project and permission to launch threads and create worktrees.

Use a dedicated CI credential. Its access determines what the launched agent
may do. Do not use a one-time pairing code as the bearer credential.

The failed sync log prints the resolution thread link. The launch request key
is derived from the lane and upstream SHAs, so retrying the same conflict with
the same MCP identity replays the original launch. A different upstream tip
starts a new session. Missing configuration, expired credentials or a rejected
launch fail visibly; they do not allow a conflicted release to proceed.

Run the handoff's protocol tests with:

```sh
node --test scripts/nightly-conflict-session.test.mjs
```
