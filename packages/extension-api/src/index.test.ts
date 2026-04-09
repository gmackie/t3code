import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { ExtensionManifestSchema, parseExtensionManifest } from "./index";

const decodeExtensionManifest = Schema.decodeUnknownSync(ExtensionManifestSchema);

describe("parseExtensionManifest", () => {
  it("accepts a valid manifest", () => {
    expect(
      decodeExtensionManifest({
        id: " thread-tools ",
        name: " Thread Tools ",
        version: " 1.0.0 ",
        description: " Adds thread controls. ",
        hostVersionRange: " ^0.1.0 ",
        slots: ["thread.sidePanel", "thread.header.actions"],
        capabilities: ["read.thread-view", "action.open-external-url"],
        clientEntries: [
          { slot: "thread.sidePanel", module: " ./ThreadPanel.tsx ", exportName: " ThreadPanel " },
          { slot: "thread.header.actions", module: " ./ThreadActions.tsx " },
        ],
      }),
    ).toEqual({
      id: "thread-tools",
      name: "Thread Tools",
      version: "1.0.0",
      description: "Adds thread controls.",
      hostVersionRange: "^0.1.0",
      slots: ["thread.sidePanel", "thread.header.actions"],
      capabilities: ["read.thread-view", "action.open-external-url"],
      clientEntries: [
        { slot: "thread.sidePanel", module: "./ThreadPanel.tsx", exportName: "ThreadPanel" },
        { slot: "thread.header.actions", module: "./ThreadActions.tsx" },
      ],
    });
  });

  it("rejects a client entry with an unknown slot", () => {
    const result = parseExtensionManifest({
      id: "thread-tools",
      name: "Thread Tools",
      version: "1.0.0",
      hostVersionRange: "^0.1.0",
      slots: ["thread.sidePanel"],
      capabilities: ["read.thread-view"],
      clientEntries: [{ slot: "thread.timeline.item.after", module: "./ThreadPanel.tsx" }],
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected manifest parsing to fail");
    }

    expect(result.errors).toEqual([
      {
        path: "clientEntries[0].slot",
        message:
          'Expected "thread.sidePanel" | "threads.sidebar.section" | "thread.header.actions", got "thread.timeline.item.after"',
      },
    ]);
  });

  it("rejects an unknown capability", () => {
    const result = parseExtensionManifest({
      id: "thread-tools",
      name: "Thread Tools",
      version: "1.0.0",
      hostVersionRange: "^0.1.0",
      slots: ["thread.sidePanel"],
      capabilities: ["read.thread-view", "action.write-provider-state"],
      clientEntries: [{ slot: "thread.sidePanel", module: "./ThreadPanel.tsx" }],
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected manifest parsing to fail");
    }

    expect(result.errors).toEqual([
      {
        path: "capabilities[1]",
        message:
          'Expected "read.thread-view" | "read.threads-list" | "action.open-external-url" | "action.open-thread" | "action.open-resource" | "action.open-workspace-file" | "action.read-workspace-file" | "action.search-workspace-entries" | "action.request-workspace-write" | "action.browser-tab-intent", got "action.write-provider-state"',
      },
    ]);
  });

  it("rejects a client entry without a module", () => {
    const result = parseExtensionManifest({
      id: "thread-tools",
      name: "Thread Tools",
      version: "1.0.0",
      hostVersionRange: "^0.1.0",
      slots: ["thread.sidePanel"],
      capabilities: ["read.thread-view"],
      clientEntries: [{ slot: "thread.sidePanel" }],
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected manifest parsing to fail");
    }

    expect(result.errors).toEqual([
      {
        path: "clientEntries[0].module",
        message: "Missing key",
      },
    ]);
  });

  it("rejects a globally valid client entry slot that is not declared in slots", () => {
    const result = parseExtensionManifest({
      id: "thread-tools",
      name: "Thread Tools",
      version: "1.0.0",
      hostVersionRange: "^0.1.0",
      slots: ["thread.sidePanel"],
      capabilities: ["read.thread-view"],
      clientEntries: [{ slot: "thread.header.actions", module: "./ThreadActions.tsx" }],
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected manifest parsing to fail");
    }

    expect(result.errors).toEqual([
      {
        path: "clientEntries[0].slot",
        message: 'Client entry slot "thread.header.actions" must be declared in slots.',
      },
    ]);
  });
});
