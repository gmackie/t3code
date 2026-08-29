import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ExternalThreadImportCandidateToken,
  type ProviderInstanceRef,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "../auth/utils.ts";

const SIGNING_SECRET_NAME = "external-thread-import-candidate-signing-key";
const SIGNING_SECRET_BYTES = 32;
const TOKEN_TTL_MS = 10 * 60 * 1_000;
export const ISSUED_AT_CLOCK_SKEW_TOLERANCE_MS = 30_000;
export const MAX_TOKEN_LENGTH = 8_192;
const CANONICAL_HMAC_SHA256_BASE64URL = /^[A-Za-z0-9_-]{43}$/;

const isCanonicalHmacSignature = (signature: string): boolean =>
  CANONICAL_HMAC_SHA256_BASE64URL.test(signature) &&
  Buffer.from(signature, "base64url").toString("base64url") === signature;

const CandidateClaims = Schema.Struct({
  v: Schema.Number,
  eid: EnvironmentId,
  pid: ProjectId,
  pi: ProviderInstanceId,
  pd: ProviderDriverKind,
  nid: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096)),
  iat: Schema.Int,
  exp: Schema.Int,
});
type CandidateClaims = typeof CandidateClaims.Type;

const decodeCandidateClaims = Schema.decodeUnknownEffect(Schema.fromJsonString(CandidateClaims));
const encodeCandidateClaims = Schema.encodeEffect(Schema.fromJsonString(CandidateClaims));

export class ExternalThreadImportCandidateTokenMalformedError extends Schema.TaggedErrorClass<ExternalThreadImportCandidateTokenMalformedError>()(
  "ExternalThreadImportCandidateTokenMalformedError",
  {},
) {
  override get message(): string {
    return "Malformed external thread import candidate token.";
  }
}

export class ExternalThreadImportCandidateTokenInvalidSignatureError extends Schema.TaggedErrorClass<ExternalThreadImportCandidateTokenInvalidSignatureError>()(
  "ExternalThreadImportCandidateTokenInvalidSignatureError",
  {},
) {
  override get message(): string {
    return "Invalid external thread import candidate token signature.";
  }
}

export class ExternalThreadImportCandidateTokenExpiredError extends Schema.TaggedErrorClass<ExternalThreadImportCandidateTokenExpiredError>()(
  "ExternalThreadImportCandidateTokenExpiredError",
  {},
) {
  override get message(): string {
    return "External thread import candidate token expired.";
  }
}

export class ExternalThreadImportCandidateTokenNotYetValidError extends Schema.TaggedErrorClass<ExternalThreadImportCandidateTokenNotYetValidError>()(
  "ExternalThreadImportCandidateTokenNotYetValidError",
  {},
) {
  override get message(): string {
    return "External thread import candidate token is not yet valid.";
  }
}

export class ExternalThreadImportCandidateTokenScopeMismatchError extends Schema.TaggedErrorClass<ExternalThreadImportCandidateTokenScopeMismatchError>()(
  "ExternalThreadImportCandidateTokenScopeMismatchError",
  {},
) {
  override get message(): string {
    return "External thread import candidate token scope does not match.";
  }
}

export class ExternalThreadImportCandidateTokenUnsupportedVersionError extends Schema.TaggedErrorClass<ExternalThreadImportCandidateTokenUnsupportedVersionError>()(
  "ExternalThreadImportCandidateTokenUnsupportedVersionError",
  { version: Schema.Number },
) {
  override get message(): string {
    return "Unsupported external thread import candidate token version.";
  }
}

export class ExternalThreadImportCandidateTokenKeyError extends Schema.TaggedErrorClass<ExternalThreadImportCandidateTokenKeyError>()(
  "ExternalThreadImportCandidateTokenKeyError",
  { operation: Schema.Literals(["issue", "verify"]) },
) {
  override get message(): string {
    return "External thread import candidate signing key is unavailable.";
  }
}

export type ExternalThreadImportCandidateTokenVerificationError =
  | ExternalThreadImportCandidateTokenMalformedError
  | ExternalThreadImportCandidateTokenInvalidSignatureError
  | ExternalThreadImportCandidateTokenExpiredError
  | ExternalThreadImportCandidateTokenNotYetValidError
  | ExternalThreadImportCandidateTokenScopeMismatchError
  | ExternalThreadImportCandidateTokenUnsupportedVersionError
  | ExternalThreadImportCandidateTokenKeyError;

export interface ExternalThreadImportCandidateScope {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly provider: ProviderInstanceRef;
}

export interface ExternalThreadImportCandidateIdentity extends ExternalThreadImportCandidateScope {
  readonly nativeThreadId: string;
}

export class ExternalThreadImportCandidateTokenCodec extends Context.Service<
  ExternalThreadImportCandidateTokenCodec,
  {
    readonly issue: (
      identity: ExternalThreadImportCandidateIdentity,
    ) => Effect.Effect<
      { readonly token: ExternalThreadImportCandidateToken; readonly expiresAt: number },
      ExternalThreadImportCandidateTokenMalformedError | ExternalThreadImportCandidateTokenKeyError
    >;
    readonly verify: (
      token: string,
      expectedScope: ExternalThreadImportCandidateScope,
    ) => Effect.Effect<
      ExternalThreadImportCandidateIdentity,
      ExternalThreadImportCandidateTokenVerificationError
    >;
  }
>()("t3/threadImport/ExternalThreadImportCandidateToken/ExternalThreadImportCandidateTokenCodec") {}

export const make = Effect.gen(function* () {
  const secretStore = yield* ServerSecretStore.ServerSecretStore;

  const loadKey = (operation: "issue" | "verify") =>
    secretStore
      .getOrCreateRandom(SIGNING_SECRET_NAME, SIGNING_SECRET_BYTES)
      .pipe(Effect.mapError(() => new ExternalThreadImportCandidateTokenKeyError({ operation })));

  const issue: ExternalThreadImportCandidateTokenCodec["Service"]["issue"] = Effect.fn(
    "ExternalThreadImportCandidateTokenCodec.issue",
  )(function* (identity) {
    const issuedAt = yield* Clock.currentTimeMillis;
    const expiresAt = issuedAt + TOKEN_TTL_MS;
    const encodedJson = yield* encodeCandidateClaims({
      v: 1,
      eid: identity.environmentId,
      pid: identity.projectId,
      pi: identity.provider.instanceId,
      pd: identity.provider.driver,
      nid: identity.nativeThreadId,
      iat: issuedAt,
      exp: expiresAt,
    }).pipe(Effect.mapError(() => new ExternalThreadImportCandidateTokenMalformedError({})));
    const encodedPayload = base64UrlEncode(encodedJson);
    const signingSecret = yield* loadKey("issue");
    return {
      token:
        `${encodedPayload}.${signPayload(encodedPayload, signingSecret)}` as ExternalThreadImportCandidateToken,
      expiresAt,
    };
  });

  const verify: ExternalThreadImportCandidateTokenCodec["Service"]["verify"] = Effect.fn(
    "ExternalThreadImportCandidateTokenCodec.verify",
  )(function* (token, expectedScope) {
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      return yield* new ExternalThreadImportCandidateTokenMalformedError({});
    }
    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return yield* new ExternalThreadImportCandidateTokenMalformedError({});
    }
    const [encodedPayload, signature] = parts as [string, string];
    if (!isCanonicalHmacSignature(signature)) {
      return yield* new ExternalThreadImportCandidateTokenInvalidSignatureError({});
    }
    const signingSecret = yield* loadKey("verify");
    if (!timingSafeEqualBase64Url(signature, signPayload(encodedPayload, signingSecret))) {
      return yield* new ExternalThreadImportCandidateTokenInvalidSignatureError({});
    }

    const json = yield* Effect.try({
      try: () => base64UrlDecodeUtf8(encodedPayload),
      catch: () => new ExternalThreadImportCandidateTokenMalformedError({}),
    });
    const claims = yield* decodeCandidateClaims(json).pipe(
      Effect.mapError(() => new ExternalThreadImportCandidateTokenMalformedError({})),
    );
    if (claims.v !== 1) {
      return yield* new ExternalThreadImportCandidateTokenUnsupportedVersionError({
        version: claims.v,
      });
    }

    const observedAt = yield* Clock.currentTimeMillis;
    if (claims.iat > observedAt + ISSUED_AT_CLOCK_SKEW_TOLERANCE_MS) {
      return yield* new ExternalThreadImportCandidateTokenNotYetValidError({});
    }
    if (claims.exp <= observedAt) {
      return yield* new ExternalThreadImportCandidateTokenExpiredError({});
    }
    if (
      claims.eid !== expectedScope.environmentId ||
      claims.pid !== expectedScope.projectId ||
      claims.pi !== expectedScope.provider.instanceId ||
      claims.pd !== expectedScope.provider.driver
    ) {
      return yield* new ExternalThreadImportCandidateTokenScopeMismatchError({});
    }
    return {
      environmentId: claims.eid,
      projectId: claims.pid,
      provider: {
        instanceId: claims.pi,
        driver: claims.pd,
      },
      nativeThreadId: claims.nid,
    };
  });

  return ExternalThreadImportCandidateTokenCodec.of({ issue, verify });
});

export const layer = Layer.effect(ExternalThreadImportCandidateTokenCodec, make);
