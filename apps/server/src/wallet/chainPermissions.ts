// @effect-diagnostics nodeBuiltinImport:off - Trusted extension permission comparison and fingerprint.
import * as NodeCrypto from "node:crypto";
import * as NodeUtil from "node:util";
import * as Schema from "effect/Schema";

const Scope = Schema.Struct({ accounts: Schema.Array(Schema.String) });
const Scopes = Schema.Record(Schema.String, Scope);
const Value = Schema.Struct({
  requiredScopes: Scopes,
  optionalScopes: Scopes,
  sessionProperties: Schema.Record(Schema.String, Schema.Unknown),
  isMultichainOrigin: Schema.Boolean,
});
const Permission = Schema.Struct({
  caveats: Schema.Array(Schema.Struct({ type: Schema.Literal("authorizedScopes"), value: Value })),
});
const Request = Schema.Struct({
  metadata: Schema.Struct({
    id: Schema.String,
    origin: Schema.String,
    isSwitchEthereumChain: Schema.Literal(true),
  }),
  permissions: Schema.Record(Schema.String, Schema.Unknown),
  diff: Schema.Struct({
    currentPermissions: Schema.Record(Schema.String, Schema.Unknown),
    permissionDiffMap: Schema.Record(Schema.String, Schema.Unknown),
  }),
});
const decodeRequest = Schema.decodeUnknownSync(Request, { onExcessProperty: "error" });
const decodePermission = Schema.decodeUnknownSync(Permission);
const decodeValue = Schema.decodeUnknownSync(Value, { onExcessProperty: "error" });
const decodeRecord = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));
const capability = "endowment:caip25";

/** Only the pinned incremental switch flow may add one chain to existing account access. */
export function decodeChainPermission(
  raw: unknown,
  subjectPermissions: unknown,
  id: string,
  origin: string,
  account: string,
) {
  const request = decodeRequest(raw);
  if (
    request.metadata.id !== id ||
    request.metadata.origin !== origin ||
    !NodeUtil.isDeepStrictEqual(request.diff.currentPermissions, subjectPermissions)
  )
    return undefined;
  const deltaMap = request.diff.permissionDiffMap;
  if (
    Object.keys(deltaMap).length !== 1 ||
    Object.keys(request.diff.currentPermissions).length !== 1
  )
    return undefined;
  const delta = decodeValue(
    deltaMap[capability] && decodeRecord(deltaMap[capability]).authorizedScopes,
  );
  const entries = Object.entries(delta.optionalScopes);
  const [scope, added] = entries[0] ?? [];
  if (
    !scope ||
    !added ||
    entries.length !== 1 ||
    !/^eip155:[1-9][0-9]*$/.test(scope) ||
    added.accounts.length ||
    Object.keys(delta.requiredScopes).length ||
    Object.keys(delta.sessionProperties).length
  )
    return undefined;
  // Compare raw values too: schema decoding must not hide extra permissions or scope fields.
  if (!NodeUtil.isDeepStrictEqual(deltaMap, { [capability]: { authorizedScopes: delta } }))
    return undefined;
  const previousRaw = decodeRecord(request.diff.currentPermissions[capability]);
  const previous = decodePermission(previousRaw);
  const [caveat] = previous.caveats;
  if (!caveat || previous.caveats.length !== 1) return undefined;
  const value = decodeValue(caveat.value);
  if (
    delta.isMultichainOrigin !== value.isMultichainOrigin ||
    Object.keys(value.sessionProperties).length ||
    value.requiredScopes[scope] ||
    value.optionalScopes[scope]
  )
    return undefined;
  const scopes = { ...value.requiredScopes, ...value.optionalScopes };
  if (
    Object.keys(scopes).some(
      (scope) => scope !== "wallet:eip155" && !/^eip155:[1-9][0-9]*$/.test(scope),
    )
  )
    return undefined;
  const accounts = Object.values(scopes).flatMap((scope) => scope.accounts);
  if (
    !accounts.length ||
    accounts.some((id) => {
      const match = /^(?:eip155:[0-9]+|wallet:eip155):(0x[0-9a-fA-F]{40})$/.exec(id);
      return match?.[1]?.toLowerCase() !== account.toLowerCase();
    })
  )
    return undefined;
  if (!NodeUtil.isDeepStrictEqual(previousRaw.caveats, [{ type: "authorizedScopes", value }]))
    return undefined;
  const next = { ...value, optionalScopes: { ...value.optionalScopes, [scope]: { accounts: [] } } };
  const expected = {
    ...request.diff.currentPermissions,
    [capability]: { ...previousRaw, caveats: [{ type: "authorizedScopes", value: next }] },
  };
  if (!NodeUtil.isDeepStrictEqual(request.permissions, expected)) return undefined;
  const chains = Object.keys({ ...next.requiredScopes, ...next.optionalScopes }).filter((scope) =>
    /^eip155:[1-9][0-9]*$/.test(scope),
  );
  return {
    chainId: `0x${BigInt(scope.split(":")[1]!).toString(16)}`,
    chainPermission: {
      fingerprint: NodeCrypto.createHash("sha256").update(JSON.stringify(request)).digest("hex"),
      chainIds: chains.map((scope) => `0x${BigInt(scope.split(":")[1]!).toString(16)}`),
    },
  };
}
