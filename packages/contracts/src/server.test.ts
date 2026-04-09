import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { ServerExtensionRegistrySnapshot } from "./server";

const decodeServerExtensionRegistrySnapshot = Schema.decodeUnknownEffect(
  ServerExtensionRegistrySnapshot,
);

it.effect("decodes extension registry snapshots with typed manifests", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeServerExtensionRegistrySnapshot({
      hostVersion: "0.0.13",
      extensions: [
        {
          id: "enabled",
          name: "Enabled",
          rootPath: "/tmp/extensions",
          extensionPath: "/tmp/extensions/enabled",
          manifestPath: "/tmp/extensions/enabled/extension.json",
          state: "enabled",
          reason: null,
          issues: [],
          repository: {
            kind: "git",
            remoteUrl: "https://github.com/t3tools/enabled.git",
            branch: "main",
            upstreamRef: "origin/main",
            localCommit: "abc123",
            remoteCommit: "abc123",
            state: "up-to-date",
            checkedAt: "2026-03-27T00:00:00.000Z",
            message: "Extension repository is up to date.",
          },
          manifest: {
            id: "enabled",
            name: "Enabled",
            version: "1.0.0",
            hostVersionRange: "*",
            slots: ["thread.sidePanel"],
            capabilities: ["read.thread-view"],
            clientEntries: [{ slot: "thread.sidePanel", module: "./EnabledPanel.tsx" }],
          },
        },
      ],
    });

    assert.equal(parsed.extensions[0]?.manifest?.clientEntries[0]?.module, "./EnabledPanel.tsx");
  }),
);

it.effect("rejects registry snapshots with invalid manifest payloads", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeServerExtensionRegistrySnapshot({
        hostVersion: "0.0.13",
        extensions: [
          {
            id: "broken",
            name: "Broken",
            rootPath: "/tmp/extensions",
            extensionPath: "/tmp/extensions/broken",
            manifestPath: "/tmp/extensions/broken/extension.json",
            state: "enabled",
            reason: null,
            issues: [],
            repository: null,
            manifest: {
              id: "broken",
              name: "Broken",
              version: "1.0.0",
              hostVersionRange: "*",
              slots: [],
              capabilities: ["read.thread-view"],
              clientEntries: [],
            },
          },
        ],
      }),
    );

    assert.equal(result._tag, "Failure");
  }),
);
