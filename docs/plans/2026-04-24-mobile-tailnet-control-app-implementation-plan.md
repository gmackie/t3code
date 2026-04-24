# Mobile Tailnet Control App Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an iPhone-first mobile control app for existing T3 Code projects, using direct Tailscale connectivity to the Mac-hosted T3 Code server, with safe v1 limits around destructive side effects.

**Architecture:** Extend the current desktop/server remote access model with a first-class `tailnet-accessible` exposure mode, then add a new Expo-based `apps/mobile` client that reuses shared contracts and a small shared runtime layer for pairing, bearer auth, and WebSocket session management. Keep the Mac as the only execution host and treat mobile as a privileged remote operator for orchestration only.

**Tech Stack:** TypeScript, Bun workspaces, Expo, React Native, Expo Router, Expo Secure Store, AsyncStorage, Effect schemas/contracts, existing T3 Code HTTP and WebSocket APIs, Vitest, React Native Testing Library.

## Constraints And Guardrails

- Do not build relay infrastructure.
- Do not add on-device agent execution.
- Do not add remote project creation in v1.
- Do not expose `push`, `create PR`, `merge`, or arbitrary script execution from mobile in v1.
- Keep `packages/contracts` schema-only.
- Reuse `packages/client-runtime` or add a small new shared runtime package rather than copying environment/auth logic into mobile.

## Task 1: Add `tailnet-accessible` desktop exposure mode and contract coverage

**Files:**

- Modify: `packages/contracts/src/ipc.ts`
- Modify: `apps/desktop/src/desktopSettings.ts`
- Modify: `apps/desktop/src/serverExposure.ts`
- Modify: `apps/desktop/src/main.ts`
- Test: `apps/desktop/src/desktopSettings.test.ts`
- Test: `apps/desktop/src/serverExposure.test.ts`
- Test: `apps/web/src/components/settings/SettingsPanels.browser.tsx`

**Step 1: Write the failing contract and desktop exposure tests**

Add cases proving the new mode round-trips through the desktop settings and exposure state.

```ts
// apps/desktop/src/serverExposure.test.ts
it("prefers an explicit tailnet host in tailnet-accessible mode", () => {
  const exposure = resolveDesktopServerExposure({
    mode: "tailnet-accessible",
    port: 3773,
    networkInterfaces: {},
    advertisedHostOverride: "100.88.12.4",
  });

  expect(exposure.mode).toBe("tailnet-accessible");
  expect(exposure.bindHost).toBe("0.0.0.0");
  expect(exposure.endpointUrl).toBe("http://100.88.12.4:3773");
});

it("falls back to local-only semantics only when tailnet host discovery fails and rejection is disabled", async () => {
  // exercise applyDesktopServerExposureMode in main.ts through a focused helper test
});
```

```ts
// apps/desktop/src/desktopSettings.test.ts
it("persists tailnet-accessible as a valid server exposure preference", () => {
  const parsed = readDesktopSettingsFromString(
    JSON.stringify({ serverExposureMode: "tailnet-accessible" }),
  );

  expect(parsed.serverExposureMode).toBe("tailnet-accessible");
});
```

**Step 2: Run the focused tests and verify they fail**

Run:

```bash
bun --cwd apps/desktop run test src/serverExposure.test.ts src/desktopSettings.test.ts
```

Expected: FAIL because `"tailnet-accessible"` is not yet part of `DesktopServerExposureMode`.

**Step 3: Make the minimal contract and desktop changes**

Add the new union member and preserve current network binding behavior while distinguishing the advertised endpoint source.

```ts
// packages/contracts/src/ipc.ts
export type DesktopServerExposureMode = "local-only" | "tailnet-accessible" | "network-accessible";
```

```ts
// apps/desktop/src/serverExposure.ts
const DESKTOP_BIND_ALL_HOST = "0.0.0.0";

export function resolveDesktopServerExposure(input: {
  readonly mode: DesktopServerExposureMode;
  readonly port: number;
  readonly networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]>;
  readonly advertisedHostOverride?: string;
}): DesktopServerExposure {
  const localHttpUrl = `http://${DESKTOP_LOOPBACK_HOST}:${input.port}`;
  const localWsUrl = `ws://${DESKTOP_LOOPBACK_HOST}:${input.port}`;

  if (input.mode === "local-only") {
    return {
      mode: input.mode,
      bindHost: DESKTOP_LOOPBACK_HOST,
      localHttpUrl,
      localWsUrl,
      endpointUrl: null,
      advertisedHost: null,
    };
  }

  const advertisedHost = resolveLanAdvertisedHost(
    input.networkInterfaces,
    input.advertisedHostOverride,
  );

  return {
    mode: input.mode,
    bindHost: DESKTOP_BIND_ALL_HOST,
    localHttpUrl,
    localWsUrl,
    endpointUrl: advertisedHost ? `http://${advertisedHost}:${input.port}` : null,
    advertisedHost,
  };
}
```

Update `apps/desktop/src/main.ts` and `apps/desktop/src/desktopSettings.ts` so `tailnet-accessible` persists and uses the same bind behavior as `network-accessible`, but with a different advertised host resolution path in the next task.

**Step 4: Re-run tests and typecheck**

Run:

```bash
bun --cwd apps/desktop run test src/serverExposure.test.ts src/desktopSettings.test.ts
bun --cwd apps/desktop run typecheck
bun --cwd packages/contracts run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/contracts/src/ipc.ts apps/desktop/src/desktopSettings.ts apps/desktop/src/serverExposure.ts apps/desktop/src/main.ts apps/desktop/src/desktopSettings.test.ts apps/desktop/src/serverExposure.test.ts apps/web/src/components/settings/SettingsPanels.browser.tsx
git commit -m "feat: add tailnet desktop exposure mode"
```

## Task 2: Add Tailscale host detection and Tailnet-specific pairing URLs

**Files:**

- Create: `apps/desktop/src/tailscale.ts`
- Modify: `apps/desktop/src/main.ts`
- Modify: `apps/server/src/startupAccess.ts`
- Modify: `apps/web/src/components/settings/ConnectionsSettings.tsx`
- Test: `apps/desktop/src/main.ts`
- Test: `apps/server/src/cliAuthFormat.test.ts`
- Test: `apps/web/src/components/settings/SettingsPanels.browser.tsx`
- Update: `REMOTE.md`

**Step 1: Write the failing Tailscale detection and URL formatting tests**

Add tests for preferring a Tailscale IP or MagicDNS hostname when `tailnet-accessible` is selected.

```ts
// apps/server/src/cliAuthFormat.test.ts
it("formats pairing URLs with the tailnet host when supplied", () => {
  const url = buildPairingUrl("http://100.88.12.4:3773", "secret-pairing-token");
  expect(url).toBe("http://100.88.12.4:3773/pair#token=secret-pairing-token");
});
```

```ts
// apps/desktop/src/tailscale.test.ts
it("prefers TS_CERT_DOMAIN when available", () => {
  expect(
    resolveTailnetAdvertisedHost({
      tailscaleIp: "100.88.12.4",
      tsCertDomain: "mackbook.tailnet.ts.net",
    }),
  ).toBe("mackbook.tailnet.ts.net");
});
```

**Step 2: Run the focused tests and verify they fail**

Run:

```bash
bun --cwd apps/server run test src/cliAuthFormat.test.ts
bun --cwd apps/desktop run test src/tailscale.test.ts
```

Expected: FAIL because the Tailscale detection utility does not exist yet.

**Step 3: Implement Tailnet host detection and wire it into desktop exposure**

Create a single-purpose helper that prefers explicit environment configuration, then a Tailscale hostname, then `tailscale ip -4`, then failure.

```ts
// apps/desktop/src/tailscale.ts
import { execFileSync } from "node:child_process";

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value) => value && value.length > 0);
}

export function resolveTailnetAdvertisedHost(input?: {
  readonly tailscaleIp?: string;
  readonly tsCertDomain?: string;
}): string | null {
  const direct = firstNonEmpty([input?.tsCertDomain, input?.tailscaleIp]);
  if (direct) return direct;

  try {
    const output = execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8" }).trim();
    return output.length > 0 ? (output.split(/\s+/)[0] ?? null) : null;
  } catch {
    return null;
  }
}
```

Then in `apps/desktop/src/main.ts`, when `tailnet-accessible` is selected, pass the resolved Tailnet host as `advertisedHostOverride`. Keep `network-accessible` on the existing LAN path.

Update `REMOTE.md` to recommend the desktop Tailnet mode and clarify that the URL shown in Settings should be Tailnet-specific.

**Step 4: Re-run the focused tests**

Run:

```bash
bun --cwd apps/server run test src/cliAuthFormat.test.ts
bun --cwd apps/desktop run test src/tailscale.test.ts src/serverExposure.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/tailscale.ts apps/desktop/src/main.ts apps/server/src/startupAccess.ts apps/web/src/components/settings/ConnectionsSettings.tsx REMOTE.md
git commit -m "feat: surface tailnet pairing endpoints"
```

## Task 3: Extract shared remote auth and environment runtime for non-web clients

**Files:**

- Modify: `packages/client-runtime/src/index.ts`
- Create: `packages/client-runtime/src/remoteAuth.ts`
- Create: `packages/client-runtime/src/remoteAuth.test.ts`
- Create: `packages/client-runtime/src/sessionTarget.ts`
- Create: `packages/client-runtime/src/sessionTarget.test.ts`
- Modify: `packages/client-runtime/package.json`

**Step 1: Write the failing runtime tests**

Cover the pure pieces first: parsing pairing URLs, deriving HTTP and WS targets, and building authenticated requests.

```ts
// packages/client-runtime/src/remoteAuth.test.ts
it("extracts the bootstrap credential from a pairing url hash", () => {
  const parsed = parsePairingUrl("http://100.88.12.4:3773/pair#token=pairing-token");
  expect(parsed.httpBaseUrl).toBe("http://100.88.12.4:3773");
  expect(parsed.credential).toBe("pairing-token");
});

it("creates bearer auth headers from a stored session token", () => {
  expect(createBearerHeaders("session-token")).toEqual({
    Authorization: "Bearer session-token",
  });
});
```

**Step 2: Run the tests and verify they fail**

Run:

```bash
bun --cwd packages/client-runtime run test
```

Expected: FAIL because the new modules do not exist yet.

**Step 3: Implement the shared runtime helpers**

Keep this package transport-only and UI-agnostic.

```ts
// packages/client-runtime/src/remoteAuth.ts
export interface ParsedPairingUrl {
  readonly httpBaseUrl: string;
  readonly credential: string;
}

export function parsePairingUrl(value: string): ParsedPairingUrl {
  const url = new URL(value);
  const hashToken = new URLSearchParams(
    url.hash.startsWith("#") ? url.hash.slice(1) : url.hash,
  ).get("token");
  const queryToken = url.searchParams.get("token");
  const credential = hashToken ?? queryToken;

  if (!credential) {
    throw new Error("Pairing URL is missing a token.");
  }

  url.pathname = "";
  url.search = "";
  url.hash = "";

  return {
    httpBaseUrl: url.toString().replace(/\/$/, ""),
    credential,
  };
}

export function createBearerHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
```

```ts
// packages/client-runtime/src/sessionTarget.ts
export function httpToWsBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString().replace(/\/$/, "");
}
```

Export the helpers from `packages/client-runtime/src/index.ts`.

**Step 4: Re-run the package tests and typecheck**

Run:

```bash
bun --cwd packages/client-runtime run test
bun --cwd packages/client-runtime run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/client-runtime/src/index.ts packages/client-runtime/src/remoteAuth.ts packages/client-runtime/src/remoteAuth.test.ts packages/client-runtime/src/sessionTarget.ts packages/client-runtime/src/sessionTarget.test.ts packages/client-runtime/package.json
git commit -m "feat: add shared remote client auth helpers"
```

## Task 4: Scaffold the Expo mobile app and shared package wiring

**Files:**

- Create: `apps/mobile/package.json`
- Create: `apps/mobile/app.json`
- Create: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/babel.config.js`
- Create: `apps/mobile/expo-env.d.ts`
- Create: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/index.tsx`
- Create: `apps/mobile/src/theme.ts`
- Create: `apps/mobile/src/providers/AppProviders.tsx`
- Create: `apps/mobile/src/state/storage.ts`
- Create: `apps/mobile/src/state/storage.test.ts`
- Modify: `turbo.json`
- Modify: `package.json`

**Step 1: Write the failing smoke test**

Create a tiny logic test for mobile storage first so the package is not just unverified scaffolding.

```ts
// apps/mobile/src/state/storage.test.ts
import { describe, expect, it } from "vitest";
import { createInMemoryMobileStorage } from "./storage";

describe("mobile storage", () => {
  it("round-trips session tokens in memory", async () => {
    const storage = createInMemoryMobileStorage();
    await storage.setItem("session", "abc");
    await expect(storage.getItem("session")).resolves.toBe("abc");
  });
});
```

**Step 2: Run the test and verify it fails**

Run:

```bash
bun --cwd apps/mobile run test
```

Expected: FAIL because `apps/mobile` does not exist yet.

**Step 3: Add the Expo app package**

Use Expo Router for route structure and keep the app minimal.

```json
// apps/mobile/package.json
{
  "name": "@t3tools/mobile",
  "private": true,
  "main": "expo-router/entry",
  "scripts": {
    "dev": "expo start --clear",
    "ios": "expo run:ios",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@react-native-async-storage/async-storage": "^2.2.0",
    "@tanstack/react-query": "^5.90.0",
    "@t3tools/client-runtime": "workspace:*",
    "@t3tools/contracts": "workspace:*",
    "expo": "^55.0.0",
    "expo-router": "^6.0.0",
    "expo-secure-store": "^16.0.0",
    "react": "^19.0.0",
    "react-native": "^0.82.0",
    "zustand": "^5.0.11"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Add root scripts:

```json
// package.json
{
  "scripts": {
    "dev:mobile": "turbo run dev --filter=@t3tools/mobile",
    "typecheck:mobile": "turbo run typecheck --filter=@t3tools/mobile"
  }
}
```

Keep the app shell intentionally tiny: a provider wrapper, a neutral theme file, and a placeholder route.

**Step 4: Run the new app test and typecheck**

Run:

```bash
bun --cwd apps/mobile run test
bun --cwd apps/mobile run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/mobile package.json turbo.json
git commit -m "feat: scaffold expo mobile app"
```

## Task 5: Implement mobile pairing, bearer session persistence, and environment registry

**Files:**

- Create: `apps/mobile/src/lib/api.ts`
- Create: `apps/mobile/src/lib/pairing.ts`
- Create: `apps/mobile/src/lib/pairing.test.ts`
- Create: `apps/mobile/src/state/environmentStore.ts`
- Create: `apps/mobile/src/state/environmentStore.test.ts`
- Create: `apps/mobile/app/pair.tsx`
- Create: `apps/mobile/app/settings.tsx`
- Modify: `packages/contracts/src/ipc.ts`

**Step 1: Write the failing pairing tests**

Cover parsing a pairing URL, exchanging it for a bearer session, and storing a saved environment record.

```ts
// apps/mobile/src/lib/pairing.test.ts
it("bootstraps a bearer session from a pairing url", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          authenticated: true,
          role: "owner",
          sessionMethod: "bearer-session-token",
          sessionToken: "session-token",
          expiresAt: "2026-04-24T20:00:00Z",
        }),
      ),
  );

  const result = await pairEnvironmentFromUrl({
    pairingUrl: "http://100.88.12.4:3773/pair#token=pairing-token",
    fetch: fetchMock,
  });

  expect(result.record.httpBaseUrl).toBe("http://100.88.12.4:3773");
  expect(result.sessionToken).toBe("session-token");
});
```

**Step 2: Run the tests and verify they fail**

Run:

```bash
bun --cwd apps/mobile run test src/lib/pairing.test.ts src/state/environmentStore.test.ts
```

Expected: FAIL because the pairing helpers and store do not exist.

**Step 3: Implement pairing and secure persistence**

Use `packages/client-runtime` for URL parsing. Store metadata in AsyncStorage and bearer tokens in Secure Store.

```ts
// apps/mobile/src/lib/pairing.ts
import { parsePairingUrl } from "@t3tools/client-runtime";

export async function pairEnvironmentFromUrl(input: {
  readonly pairingUrl: string;
  readonly fetch: typeof globalThis.fetch;
}) {
  const parsed = parsePairingUrl(input.pairingUrl);
  const response = await input.fetch(`${parsed.httpBaseUrl}/api/auth/bootstrap/bearer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential: parsed.credential }),
  });

  if (!response.ok) {
    throw new Error("Pairing failed.");
  }

  const payload = await response.json();

  return {
    record: {
      environmentId: `mobile:${parsed.httpBaseUrl}`,
      label: new URL(parsed.httpBaseUrl).host,
      httpBaseUrl: parsed.httpBaseUrl,
      wsBaseUrl: parsed.httpBaseUrl.replace(/^http/, "ws"),
      createdAt: new Date().toISOString(),
      lastConnectedAt: null,
    },
    sessionToken: payload.sessionToken as string,
  };
}
```

Build a tiny Zustand store for environment metadata and a settings screen that can add, list, and revoke local device sessions later.

**Step 4: Re-run the tests**

Run:

```bash
bun --cwd apps/mobile run test src/lib/pairing.test.ts src/state/environmentStore.test.ts
bun --cwd apps/mobile run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/mobile/src/lib apps/mobile/src/state apps/mobile/app/pair.tsx apps/mobile/app/settings.tsx
git commit -m "feat: add mobile pairing and environment storage"
```

## Task 6: Implement read-only mobile runtime, inbox, and live thread detail

**Files:**

- Create: `apps/mobile/src/lib/runtimeClient.ts`
- Create: `apps/mobile/src/lib/runtimeClient.test.ts`
- Create: `apps/mobile/src/state/threadStore.ts`
- Create: `apps/mobile/src/state/threadStore.test.ts`
- Create: `apps/mobile/app/(tabs)/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/index.tsx`
- Create: `apps/mobile/app/(tabs)/threads.tsx`
- Create: `apps/mobile/app/thread/[threadId].tsx`
- Create: `apps/mobile/src/components/InboxList.tsx`
- Create: `apps/mobile/src/components/ThreadList.tsx`
- Create: `apps/mobile/src/components/ThreadTranscript.tsx`

**Step 1: Write the failing runtime tests**

Cover snapshot loading plus a lightweight event reducer for thread and inbox state.

```ts
// apps/mobile/src/state/threadStore.test.ts
it("promotes blocked approvals into the inbox", () => {
  const state = reduceRuntimeSnapshot(initialState, {
    threads: [
      {
        id: "thread-1",
        title: "Fix auth issue",
        session: { status: "running", updatedAt: "2026-04-24T20:00:00Z" },
        pendingUserInput: { kind: "approval", prompt: "Apply this patch?" },
      },
    ],
  });

  expect(state.inbox[0]?.threadId).toBe("thread-1");
  expect(state.inbox[0]?.kind).toBe("approval");
});
```

**Step 2: Run the tests and verify they fail**

Run:

```bash
bun --cwd apps/mobile run test src/lib/runtimeClient.test.ts src/state/threadStore.test.ts
```

Expected: FAIL because the runtime client and reducer do not exist.

**Step 3: Implement read-only runtime syncing**

Use existing HTTP snapshot APIs and the authenticated `/ws` stream. Cache the last good snapshot so the UI can render stale data during reconnects.

```ts
// apps/mobile/src/lib/runtimeClient.ts
export async function issueWsToken(input: {
  readonly httpBaseUrl: string;
  readonly sessionToken: string;
}) {
  const response = await fetch(`${input.httpBaseUrl}/api/auth/ws-token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${input.sessionToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Unable to issue WebSocket token.");
  }

  return (await response.json()) as { token: string; expiresAt: string };
}
```

Build tabs for `Inbox` and `Threads`, and a dedicated thread route that renders:

- latest transcript
- live/stale/reconnecting badge
- changed-file summary stub area

Do not add mutation actions yet in this task.

**Step 4: Re-run the tests**

Run:

```bash
bun --cwd apps/mobile run test src/lib/runtimeClient.test.ts src/state/threadStore.test.ts
bun --cwd apps/mobile run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/mobile/app apps/mobile/src/lib/runtimeClient.ts apps/mobile/src/state/threadStore.ts apps/mobile/src/components
git commit -m "feat: add mobile inbox and live thread views"
```

## Task 7: Add mobile operator actions, approvals, and recovery controls

**Files:**

- Create: `apps/mobile/src/lib/threadActions.ts`
- Create: `apps/mobile/src/lib/threadActions.test.ts`
- Create: `apps/mobile/src/components/ThreadComposer.tsx`
- Create: `apps/mobile/src/components/ApprovalCard.tsx`
- Create: `apps/mobile/src/components/RecoveryActions.tsx`
- Modify: `apps/mobile/app/thread/[threadId].tsx`
- Modify: `apps/mobile/src/state/threadStore.ts`

**Step 1: Write the failing action tests**

Cover the three v1 mutation classes:

- send prompt / reply
- approve or choose an option
- reconnect / stop / restart session

```ts
// apps/mobile/src/lib/threadActions.test.ts
it("dispatches a prompt reply to the orchestration endpoint", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

  await sendThreadPrompt({
    httpBaseUrl: "http://100.88.12.4:3773",
    sessionToken: "session-token",
    threadId: "thread-1",
    text: "Continue with the safer refactor.",
    fetch: fetchMock,
  });

  expect(fetchMock).toHaveBeenCalled();
});
```

**Step 2: Run the tests and verify they fail**

Run:

```bash
bun --cwd apps/mobile run test src/lib/threadActions.test.ts
```

Expected: FAIL because the action helpers do not exist.

**Step 3: Implement the minimal operator action layer**

Wrap the existing orchestration routes rather than inventing mobile-only endpoints. If an action is missing server-side, add the smallest possible server surface in a follow-up patch during execution.

```ts
// apps/mobile/src/lib/threadActions.ts
export async function sendThreadPrompt(input: {
  readonly httpBaseUrl: string;
  readonly sessionToken: string;
  readonly threadId: string;
  readonly text: string;
  readonly fetch?: typeof globalThis.fetch;
}) {
  const runFetch = input.fetch ?? globalThis.fetch;
  const response = await runFetch(`${input.httpBaseUrl}/api/orchestration/dispatch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${input.sessionToken}`,
    },
    body: JSON.stringify({
      type: "thread.message.send",
      threadId: input.threadId,
      text: input.text,
    }),
  });

  if (!response.ok) {
    throw new Error("Unable to send thread prompt.");
  }
}
```

Render these controls in `app/thread/[threadId].tsx`:

- composer
- approval / option cards
- reconnect stream
- stop current run
- restart provider session
- recreate session, visually separate as last resort

Do not add PR, merge, push, or arbitrary script actions.

**Step 4: Re-run the tests**

Run:

```bash
bun --cwd apps/mobile run test src/lib/threadActions.test.ts src/state/threadStore.test.ts
bun --cwd apps/mobile run typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/mobile/src/lib/threadActions.ts apps/mobile/src/lib/threadActions.test.ts apps/mobile/src/components/ThreadComposer.tsx apps/mobile/src/components/ApprovalCard.tsx apps/mobile/src/components/RecoveryActions.tsx apps/mobile/app/thread/[threadId].tsx apps/mobile/src/state/threadStore.ts
git commit -m "feat: add mobile thread controls and recovery actions"
```

## Task 8: Add compact diff/file preview and final repo-wide verification

**Files:**

- Create: `apps/mobile/src/components/ChangedFilesList.tsx`
- Create: `apps/mobile/src/components/FilePreview.tsx`
- Create: `apps/mobile/src/components/FilePreview.test.tsx`
- Modify: `apps/mobile/app/thread/[threadId].tsx`
- Modify: `docs/plans/2026-04-24-mobile-tailnet-control-app-design.md`
- Update: `README.md`

**Step 1: Write the failing preview test**

```tsx
// apps/mobile/src/components/FilePreview.test.tsx
it("renders a compact preview for a changed file", () => {
  const screen = render(
    <FilePreview
      path="apps/server/src/auth/http.ts"
      language="ts"
      contents={'export const sample = "preview";'}
    />,
  );

  expect(screen.getByText("apps/server/src/auth/http.ts")).toBeTruthy();
});
```

**Step 2: Run the test and verify it fails**

Run:

```bash
bun --cwd apps/mobile run test src/components/FilePreview.test.tsx
```

Expected: FAIL because the preview components do not exist.

**Step 3: Implement the preview UI**

Keep the UI intentionally compact. It only needs enough fidelity to support acting from the phone.

```tsx
// apps/mobile/src/components/ChangedFilesList.tsx
export function ChangedFilesList(props: {
  readonly files: ReadonlyArray<{ path: string; summary?: string }>;
  readonly onSelect: (path: string) => void;
}) {
  return (
    <>
      {props.files.map((file) => (
        <Pressable key={file.path} onPress={() => props.onSelect(file.path)}>
          <Text>{file.path}</Text>
          {file.summary ? <Text>{file.summary}</Text> : null}
        </Pressable>
      ))}
    </>
  );
}
```

Update `README.md` with a short note that mobile now exists as an in-progress workspace and that Tailnet is the recommended remote path.

**Step 4: Run final verification**

Run:

```bash
bun fmt
bun lint
bun typecheck
```

Expected:

- `bun fmt`: PASS
- `bun lint`: existing warnings only unless the implementation introduces new ones
- `bun typecheck`: PASS

**Step 5: Commit**

```bash
git add apps/mobile README.md docs/plans/2026-04-24-mobile-tailnet-control-app-design.md
git commit -m "feat: add mobile diff preview and docs polish"
```

## Execution Notes

- Use TDD exactly. Every task starts with a failing test.
- Prefer the smallest possible server changes. Mobile should mostly reuse existing auth and orchestration surfaces.
- Keep the mobile app useful under reconnect and stale-cache conditions. That is the whole game.
- If Expo monorepo setup requires one extra root config file during execution, add it in the smallest possible patch and update Task 4 rather than improvising large structural changes.

## Final Verification Checklist

Run from the repo root before claiming the branch is ready:

```bash
bun fmt
bun lint
bun typecheck
```

Run the end-to-end manual check on a real iPhone and Tailnet-connected Mac:

1. Pair from a Tailnet QR code.
2. Open Inbox on mobile and confirm active threads appear.
3. Open a running thread and watch transcript updates.
4. Send a reply from mobile and verify it lands on the Mac-hosted session.
5. Resolve an approval from mobile.
6. Force a disconnect, resume the app, and confirm stale-to-live recovery.
7. Restart a stuck provider session from mobile and verify recovery.
