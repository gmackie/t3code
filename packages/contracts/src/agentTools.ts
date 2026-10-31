import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ForwardCompatibleArray, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Lowercase letters, digits, `-` and `_`, starting with a letter: the subset
 * every provider accepts as a server key and tool prefix (Claude names tools
 * `mcp__<server>__<tool>`, OpenCode `<server>_<tool>`).
 */
const MCP_SERVER_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;
const MCP_SERVER_NAME_MAX_CHARS = 48;
const RESERVED_MCP_SERVER_NAMES: ReadonlySet<string> = new Set(["t3-code"]);

export const McpServerName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MCP_SERVER_NAME_MAX_CHARS),
  Schema.isPattern(MCP_SERVER_NAME_PATTERN),
  Schema.makeFilter((name: string) =>
    RESERVED_MCP_SERVER_NAMES.has(name) ? `"${name}" is reserved for T3 Code.` : true,
  ),
);
export type McpServerName = typeof McpServerName.Type;

/**
 * An environment variable or HTTP header. A `sensitive` value lives in the secret
 * store; clients see it empty with `valueRedacted`, and echoing that keeps it.
 * After a rename, `storedAs` names the old secret so the save moves it.
 */
export const McpServerVariable = Schema.Struct({
  name: TrimmedNonEmptyString,
  value: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  sensitive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  valueRedacted: Schema.optionalKey(Schema.Boolean),
  storedAs: Schema.optionalKey(
    Schema.Struct({ server: TrimmedNonEmptyString, variable: TrimmedNonEmptyString }),
  ),
});
export type McpServerVariable = typeof McpServerVariable.Type;

export const McpStdioTransport = Schema.Struct({
  type: Schema.Literal("stdio"),
  command: TrimmedNonEmptyString,
  args: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  env: Schema.Array(McpServerVariable).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type McpStdioTransport = typeof McpStdioTransport.Type;

/**
 * Sign in to an http server with OAuth. T3 runs discovery, client registration
 * and refresh, keeps the tokens in its secret store, and reaches the server for
 * agents through its own proxy so no provider ever holds the token. `clientId`
 * is for servers without dynamic client registration.
 */
export const McpOAuthSettings = Schema.Struct({
  scopes: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  clientId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type McpOAuthSettings = typeof McpOAuthSettings.Type;

export const McpHttpTransport = Schema.Struct({
  type: Schema.Literal("http"),
  url: TrimmedNonEmptyString,
  headers: Schema.Array(McpServerVariable).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  oauth: Schema.optionalKey(McpOAuthSettings),
});
export type McpHttpTransport = typeof McpHttpTransport.Type;

export const McpServerTransport = Schema.Union([McpStdioTransport, McpHttpTransport]);
export type McpServerTransport = typeof McpServerTransport.Type;

export const McpServerConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  transport: McpServerTransport,
});
export type McpServerConfig = typeof McpServerConfig.Type;

export const McpServerProjectOverride = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  transport: Schema.optionalKey(McpServerTransport),
});
export type McpServerProjectOverride = typeof McpServerProjectOverride.Type;

export const McpServers = Schema.Record(McpServerName, McpServerConfig);
export type McpServers = typeof McpServers.Type;

export const McpServerProjectOverrides = Schema.Record(McpServerName, McpServerProjectOverride);
export type McpServerProjectOverrides = typeof McpServerProjectOverrides.Type;

export const DisabledSkills = ForwardCompatibleArray(TrimmedNonEmptyString);
export type DisabledSkills = typeof DisabledSkills.Type;

export const DisabledSkillsProjectOverride = Schema.Record(TrimmedNonEmptyString, Schema.Boolean);
export type DisabledSkillsProjectOverride = typeof DisabledSkillsProjectOverride.Type;

export interface ResolvedMcpServer {
  readonly name: McpServerName;
  readonly transport: McpServerTransport;
}

export function mcpServerVariableRecord(
  variables: ReadonlyArray<McpServerVariable>,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const variable of variables) {
    if (variable.valueRedacted === true && variable.value.length === 0) continue;
    record[variable.name] = variable.value;
  }
  return record;
}

export const isValidMcpServerName: (name: unknown) => name is McpServerName =
  Schema.is(McpServerName);

export function mcpServerTransportSummary(transport: McpServerTransport): string {
  return transport.type === "stdio"
    ? [transport.command, ...transport.args].join(" ")
    : transport.url;
}

/**
 * Where an OAuth server's sign-in stands in this environment. Tokens are per
 * server name and URL, so a project override pointing elsewhere signs in on
 * its own. `needs-auth` means a stored sign-in stopped refreshing.
 */
export const McpOAuthStatus = Schema.Union([
  Schema.Struct({ status: Schema.Literal("signed-out") }),
  Schema.Struct({
    status: Schema.Literal("connected"),
    /** Epoch milliseconds the access token expires, when the server says. */
    expiresAt: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({ status: Schema.Literal("needs-auth") }),
]);
export type McpOAuthStatus = typeof McpOAuthStatus.Type;

export const McpOAuthStatusInput = Schema.Struct({
  projectId: Schema.optionalKey(ProjectId),
});
export type McpOAuthStatusInput = typeof McpOAuthStatusInput.Type;

/** Statuses for every OAuth server in the effective settings, by name. */
export const McpOAuthStatusResult = Schema.Record(McpServerName, McpOAuthStatus);
export type McpOAuthStatusResult = typeof McpOAuthStatusResult.Type;

export const McpOAuthServerInput = Schema.Struct({
  server: McpServerName,
  projectId: Schema.optionalKey(ProjectId),
});
export type McpOAuthServerInput = typeof McpOAuthServerInput.Type;

export const McpOAuthSignInInput = Schema.Struct({
  server: McpServerName,
  projectId: Schema.optionalKey(ProjectId),
  /**
   * The origin the client reaches this server at. The provider redirects the
   * browser there, so it must be one the user's browser can open.
   */
  callbackOrigin: TrimmedNonEmptyString,
});
export type McpOAuthSignInInput = typeof McpOAuthSignInInput.Type;

/** A sign-in streams `authorize` once, then `connected` when the browser returns. */
export const McpOAuthSignInEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("authorize"), authorizationUrl: TrimmedNonEmptyString }),
  Schema.Struct({ type: Schema.Literal("connected") }),
]);
export type McpOAuthSignInEvent = typeof McpOAuthSignInEvent.Type;

export class McpOAuthError extends Schema.TaggedError<McpOAuthError>()("McpOAuthError", {
  server: Schema.String,
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
