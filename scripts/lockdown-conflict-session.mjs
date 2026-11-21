import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";

// T3 Code Locked's daily merge of upstream main hands conflicts to an unattended T3 session on
// gmacko-mini, like the GMACKO nightly (scripts/nightly-conflict-session.mjs on custom-local).
export function launchArguments({ projectId, laneSha, upstreamSha, files, runUrl }) {
  return {
    projectId,
    modelSelection: { instanceId: "codex", model: "gpt-6.1-sol" },
    runtimeMode: "auto",
    title: `Resolve lockdown upstream conflict ${upstreamSha.slice(0, 8)}`,
    // Bump the version when the prompt changes so a stalled session from an
    // older prompt does not absorb the relaunch for the same commit pair.
    clientRequestId: `lockdown-conflict-v1-${laneSha}-${upstreamSha}`,
    workspaceStrategy: {
      type: "worktree",
      baseRef: "forgejo/lockdown",
      startFromOrigin: true,
    },
    message: [
      "Resolve the T3 Code Locked daily upstream merge conflict on gmacko-mini.",
      `Repository: gmackie/t3code. Target branch: lockdown. Lockdown SHA: ${laneSha}. Upstream main (github.com/pingdotgg/t3code) SHA: ${upstreamSha}.`,
      `CI run: ${runUrl}`,
      `Conflicted files: ${JSON.stringify(files)}`,
      "This session runs unattended; nobody can answer credential or approval prompts, so never wait on one. Track the work in Kanbanger (search for an open issue titled `Sync lockdown with upstream main <short upstream SHA>` before creating one, team GMA, project T3Code) when the `kanbanger` CLI works here. If it is unavailable, do not stop: proceed and state in the PR body that the Kanbanger issue still needs linking.",
      "The locked edition guards upstream code at a few choke points behind LOCKDOWN_EDITION (packages/shared/src/lockdownEdition.ts, apps/server/src/lockdown, apps/desktop/src/lockdown, scripts/lib/lockdown-build-config.ts). Merge upstream main into lockdown in this isolated worktree, keeping every lockdown guard and taking upstream behavior everywhere else. Never resolve a conflict by dropping a guard or by restoring code a guard disables. When upstream adds a new outbound path (provider, integration, telemetry, download, update or catalog fetch), disable it in lockdown at its choke point and add a test. Regenerate the lockfile with pnpm, then run `bash scripts/verify-lockdown-ci.sh`; it must pass.",
      "Open or update a Forgejo PR with base lockdown (FG_APP=t3code forge pr create), link it to the issue when there is one and to this T3 thread. Lockdown PRs get no PR CI: lockdown-build builds the branch after merge. Do not merge; leave the PR for the owner. Finish with the PR URL, head SHA, verify-lockdown-ci result, and any blockers.",
    ].join("\n\n"),
  };
}

export async function startConflictSession({ endpoint, token, ...input }, fetcher = fetch) {
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) {
    throw new Error("T3 MCP endpoint must use HTTPS or loopback HTTP");
  }
  let session;
  async function rpc(method, params, id) {
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
      ...(session ? { "Mcp-Session-Id": session } : {}),
    };
    let response;
    try {
      response = await fetcher(url, {
        method: "POST",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          jsonrpc: "2.0",
          ...(id === undefined ? {} : { id }),
          method,
          params,
        }),
      });
    } catch (error) {
      // Network failures (tailnet relay drops, timeouts) are worth retrying.
      const cause = error?.cause?.code ?? error?.cause?.message ?? error?.name;
      throw Object.assign(new Error(`T3 MCP ${method} unreachable: ${cause ?? "fetch failed"}`), {
        retryable: true,
      });
    }
    if (!response.ok)
      throw Object.assign(new Error(`T3 MCP ${method} failed: HTTP ${response.status}`), {
        retryable: response.status >= 500,
      });
    session = response.headers.get("mcp-session-id") ?? session;
    if (id === undefined) return;
    let reply;
    if (response.headers.get("content-type")?.includes("text/event-stream")) {
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      try {
        while (!reply) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop();
          for (const event of events) {
            const data = event
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (!data) continue;
            const message = JSON.parse(data);
            if (message.id === id) {
              reply = message;
              break;
            }
          }
        }
      } finally {
        await reader.cancel();
      }
    } else {
      const message = await response.json();
      if (message.id === id) reply = message;
    }
    if (!reply || reply.error) throw new Error(`T3 MCP ${method} returned no successful result`);
    return reply.result;
  }
  await rpc(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t3-nightly-conflict", version: "1" },
    },
    1,
  );
  await rpc("notifications/initialized", {});
  const result = await rpc(
    "tools/call",
    { name: "t3_thread_launch", arguments: launchArguments(input) },
    2,
  );
  if (result?.isError)
    throw new Error(
      "T3 rejected the conflict session launch; inspect MCP access and project configuration",
    );
  const launched =
    result?.structuredContent ??
    result?.content
      ?.filter((entry) => entry.type === "text")
      .map((entry) => {
        try {
          return JSON.parse(entry.text);
        } catch {
          return undefined;
        }
      })
      .find((entry) => entry?.threadId);
  if (!launched?.threadId) throw new Error("T3 launch response did not confirm a thread");
  return { threadId: launched.threadId, link: launched.link };
}

// Retries the whole handoff on transient failures. The stable clientRequestId
// makes a repeated launch return the session a lost reply already created.
export async function startConflictSessionWithRetry(
  input,
  {
    fetcher = fetch,
    attempts = 6,
    delayMs = 30_000,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {},
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await startConflictSession(input, fetcher);
    } catch (error) {
      if (!error?.retryable || attempt >= attempts) throw error;
      console.error(`${error.message}; retrying (${attempt}/${attempts - 1})`);
      await sleep(delayMs);
    }
  }
}

if (process.argv[1] && import.meta.url === NodeURL.pathToFileURL(process.argv[1]).href) {
  try {
    const required = (name) => {
      const value = process.env[name];
      if (!value) throw new Error(`${name} is required for conflict handoff`);
      return value;
    };
    const result = await startConflictSessionWithRetry({
      endpoint: required("T3_CONFLICT_MCP_URL"),
      token: required("T3_CONFLICT_MCP_TOKEN"),
      projectId: required("T3_CONFLICT_PROJECT_ID"),
      laneSha: required("CONFLICT_LANE_SHA"),
      upstreamSha: required("CONFLICT_UPSTREAM_SHA"),
      runUrl: required("CONFLICT_RUN_URL"),
      files: (await NodeFSP.readFile(required("CONFLICT_FILES_PATH"), "utf8"))
        .split("\0")
        .filter(Boolean),
    });
    console.log(`Conflict resolution session: ${result.link ?? result.threadId}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Conflict handoff failed");
    process.exitCode = 1;
  }
}
