import * as NodeFSP from "node:fs/promises";
import * as NodeURL from "node:url";

export function launchArguments({ projectId, laneSha, upstreamSha, files, runUrl }) {
  return {
    projectId,
    modelSelection: { instanceId: "codex", model: "gpt-6.1-sol" },
    runtimeMode: "auto",
    title: `Resolve nightly upstream conflict ${upstreamSha.slice(0, 8)}`,
    clientRequestId: `nightly-conflict-${laneSha}-${upstreamSha}`,
    workspaceStrategy: {
      type: "worktree",
      baseRef: "forgejo/custom-local",
      startFromOrigin: true,
    },
    message: [
      "Resolve the T3 Code nightly upstream merge conflict on gmacko-mini.",
      `Repository: gmackie/t3code. Target branch: custom-local. Lane SHA: ${laneSha}. Upstream main SHA: ${upstreamSha}.`,
      `CI run: ${runUrl}`,
      `Conflicted files: ${JSON.stringify(files)}`,
      "Create or reuse a Kanbanger issue before implementation. Fetch the current lane and upstream; resolve the merge in this isolated worktree, preserving lane features and upstream behavior. Do not use blanket ours/theirs resolution. Regenerate the lockfile when needed.",
      "Open or update a PR to custom-local, link it to the issue and T3 thread, run focused checks and handle CI findings. Automatically approve only when all required checks pass on the exact head. Merge only when no nightly release is active. Verify desktop/CLI publication and iOS TestFlight delivery; keep the issue open until verified. Report blockers in the thread and issue.",
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
