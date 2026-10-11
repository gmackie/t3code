# Connecting an environment to Bob

Configure `<T3 state directory>/bob-coordination.json` on each environment.
The default state directory is `<T3 home>/userdata`. Keep this operator-owned
file private; credentials are never returned to clients or stored in execution payloads.

```json
{
  "coordinator": {
    "baseUrl": "http://bob.internal:4780",
    "authToken": "<Bob viewer principal token>"
  },
  "receiptCoordinator": {
    "baseUrl": "http://bob.internal:4780",
    "authToken": "<Bob environment receipt principal token>"
  },
  "projects": {
    "<T3 project ID>": {
      "target": {
        "environmentId": "<this T3 environment ID>",
        "projectId": "<T3 project ID>",
        "repository": { "integrationId": "forgegraph", "repositoryId": "<repository ID>" }
      },
      "issueProject": {
        "integrationId": "kanbanger",
        "workspaceId": "<workspace ID>",
        "teamId": "<team ID>",
        "projectId": "<Kanbanger project ID>"
      }
    }
  },
  "executionProfiles": {
    "cliapiproxy": {
      "modelSelection": { "instanceId": "<configured provider instance ID>", "model": "<model>" },
      "runtimeMode": "full-access"
    }
  }
}
```

Provider instances use the environment's existing CLIAPIProxy or Pistache setup.
Profiles pin the model and runtime mode at admission; no coordinator credential
selects a model or forwards provider credentials between environments.

Bob's viewer and receipt principals must share the same owner/workspace policy.
Only the receipt principal should allow `RecordExecutionReceipt`, and its trusted
context must bind `receiptEnvironmentId` to this environment. Configure Bob's
explicit `DispatchOnce` CLI with exact target bindings and a T3 service credential
with `orchestration:read` and `orchestration:operate` scopes. Preserve that credential's
subject on rotation: native admission lookup is scoped to the authenticated subject.
Bob capability negotiation requires durable SubmitExecution and FindExecution.

The terminal receipt worker records the original run's immutable root checkpoint,
preserves a Git bundle in `bob-evidence/<SHA256(requestId)>.bundle`, and sends the
same durable outbox payload until Bob acknowledges its event and sequence. The
receipt's commit is a checkpoint commit, not a PR head; `treeDigest` is SHA256 of
`git-tree:<Git tree object ID>`. Missing checkpoints remain unreconciled rather than
using the current worktree as evidence. This first bridge supports Git checkpoint
captures; interruption, missing checkpoints, and non-Git work need explicit recovery.
Outbox delivery retries on relevant events, restart, and every 30 seconds.

Agents use `bob_coordination` through T3 MCP, including the existing
`acp-mcp-call bob_coordination '<operation JSON>'` CLI transport. It restricts
plans to the caller's project and requires a live full-access/default caller for
mutations. Operations use the ForgeC schema in `packages/contracts/src/bob`;
regenerate types with `node scripts/sync-bob-contract.mjs <Bob generated directory>`
and verify with `node scripts/sync-bob-contract.mjs --check`. Bob's ForgeC compiler
pin and generated schema remain the contract source.
