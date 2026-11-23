// @effect-diagnostics nodeBuiltinImport:off - Plugin view ids use Node's synchronous digest.
import * as NodeCrypto from "node:crypto";

import type { ThreadId } from "@t3tools/contracts";
import {
  injectMcpAppCsp,
  MCP_APP_MAX_HTML_BYTES,
  MCP_APP_MIME_TYPE,
  MCP_APP_RESOURCE_SCHEME,
  readMcpAppCsp,
  readMcpAppPermissions,
  type McpAppReference,
} from "@t3tools/shared/mcpApp";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Predicate from "effect/Predicate";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { createAttachmentId, createDeterministicAttachmentId } from "../attachmentStore.ts";

const encoder = new TextEncoder();

function readMcpAppDocument(
  contents: ReadonlyArray<unknown>,
  uri: string,
): { readonly html: string | null; readonly meta: unknown } | undefined {
  for (const content of contents) {
    if (!Predicate.isObject(content)) continue;
    if (content.uri !== undefined && content.uri !== uri) continue;
    const mimeType = typeof content.mimeType === "string" ? content.mimeType : "";
    if (mimeType.replace(/\s+/g, "").toLowerCase() !== MCP_APP_MIME_TYPE) continue;
    // Bound before decoding to avoid oversized copies; UTF-8 is at least string length, base64 decodes to 3/4.
    const html =
      typeof content.text === "string"
        ? content.text.length > MCP_APP_MAX_HTML_BYTES
          ? null
          : content.text
        : typeof content.blob === "string"
          ? content.blob.length > Math.ceil(MCP_APP_MAX_HTML_BYTES / 3) * 4
            ? null
            : Buffer.from(content.blob, "base64").toString("utf8")
          : undefined;
    if (html === null) return { html: null, meta: undefined };
    if (html === undefined || html.trim() === "") continue;
    const meta = Predicate.isObject(content._meta) ? content._meta.ui : undefined;
    return { html, meta };
  }
  return undefined;
}

/**
 * A thread owns the snapshots its tool calls produce. A plugin's panel views
 * are stored under the plugin's segment with an id derived from their content,
 * so reopening an unchanged view reuses its file and an edited view gets a new
 * URL without a version bump.
 */
export type McpAppSnapshotOwner =
  | { readonly threadId: ThreadId }
  | { readonly pluginSegment: string };

const snapshotAttachmentId = (owner: McpAppSnapshotOwner, document: string) => {
  if ("threadId" in owner) return createAttachmentId(owner.threadId, "html");
  const digest = NodeCrypto.createHash("sha256").update(document).digest("hex");
  const id = createDeterministicAttachmentId(owner.pluginSegment, digest);
  return id === null ? null : `${id}-html`;
};

export const snapshotMcpApp = Effect.fn("McpAppSnapshot.snapshot")(function* (input: {
  readonly attachmentsDir: string;
  readonly owner: McpAppSnapshotOwner;
  readonly server: string;
  readonly tool: string;
  readonly resourceUri: string;
  readonly contents: ReadonlyArray<unknown>;
}) {
  if (!input.resourceUri.startsWith(MCP_APP_RESOURCE_SCHEME)) return undefined;
  const document = readMcpAppDocument(input.contents, input.resourceUri);
  if (document === undefined) return undefined;
  if (document.html === null || encoder.encode(document.html).byteLength > MCP_APP_MAX_HTML_BYTES) {
    yield* Effect.logWarning("MCP app document exceeds the size limit.", {
      server: input.server,
      resourceUri: input.resourceUri,
    });
    return undefined;
  }
  const html = document.html;
  const ui = Predicate.isObject(document.meta) ? document.meta : {};
  const csp = readMcpAppCsp(ui.csp);
  const contents = injectMcpAppCsp(html, csp);
  // The `-html` suffix makes the asset route serve it as a sandboxed document.
  const attachmentId = snapshotAttachmentId(input.owner, contents);
  const filePath =
    attachmentId === null
      ? null
      : resolveAttachmentRelativePath({
          attachmentsDir: input.attachmentsDir,
          relativePath: `${attachmentId}.html`,
        });
  if (attachmentId === null || filePath === null) return undefined;
  const fileSystem = yield* FileSystem.FileSystem;
  const unchanged = "pluginSegment" in input.owner && (yield* fileSystem.exists(filePath));
  if (!unchanged) {
    // Failed or interrupted writes remove documents that thread deletion cannot yet find.
    yield* fileSystem
      .writeFileString(filePath, contents)
      .pipe(Effect.onError(() => fileSystem.remove(filePath, { force: true }).pipe(Effect.ignore)));
  }
  const permissions = readMcpAppPermissions(ui.permissions);
  return {
    attachmentId,
    server: input.server,
    tool: input.tool,
    resourceUri: input.resourceUri,
    ...(csp === undefined ? {} : { csp }),
    ...(permissions === undefined ? {} : { permissions }),
    ...(typeof ui.prefersBorder === "boolean" ? { prefersBorder: ui.prefersBorder } : {}),
  } satisfies McpAppReference;
});
