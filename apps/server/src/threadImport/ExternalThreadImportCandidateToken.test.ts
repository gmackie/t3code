import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { base64UrlDecodeUtf8, base64UrlEncode, signPayload } from "../auth/utils.ts";
import * as ServerConfig from "../config.ts";
import * as CandidateToken from "./ExternalThreadImportCandidateToken.ts";

const environmentId = EnvironmentId.make("environment-1");
const projectId = ProjectId.make("project-1");
const providerInstanceId = ProviderInstanceId.make("codex_personal");
const provider = {
  instanceId: providerInstanceId,
  driver: ProviderDriverKind.make("codex"),
} as const;
const nativeThreadId = "native-thread-1";

const scope = { environmentId, projectId, provider } as const;

const configLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-external-thread-token-test-",
});
const secretLayer = ServerSecretStore.layer.pipe(Layer.provide(configLayer));
const tokenLayer = CandidateToken.layer.pipe(Layer.provide(secretLayer));
const tokenAndSecretLayer = Layer.merge(tokenLayer, secretLayer);
const UnknownJsonString = Schema.fromJsonString(Schema.Unknown);
const decodeUnknownJson = Schema.decodeUnknownSync(UnknownJsonString);
const encodeUnknownJson = Schema.encodeSync(UnknownJsonString);

const decodePayload = (token: string): Record<string, unknown> => {
  const encodedPayload = token.split(".")[0];
  if (!encodedPayload) throw new Error("missing payload");
  return decodeUnknownJson(base64UrlDecodeUtf8(encodedPayload)) as Record<string, unknown>;
};

it.layer(NodeServices.layer)("ExternalThreadImportCandidateToken", (it) => {
  it.effect("round-trips minimum routing claims", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000_000);
      const codec = yield* CandidateToken.ExternalThreadImportCandidateTokenCodec;
      const issued = yield* codec.issue({ ...scope, nativeThreadId });
      const verified = yield* codec.verify(issued.token, scope);

      expect(verified).toEqual({ ...scope, nativeThreadId });
      expect(issued.expiresAt).toBe(1_600_000);
    }).pipe(Effect.provide(tokenAndSecretLayer)),
  );

  it.effect("contains no transcript path or display metadata claim", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000_000);
      const codec = yield* CandidateToken.ExternalThreadImportCandidateTokenCodec;
      const issued = yield* codec.issue({ ...scope, nativeThreadId });

      expect(decodePayload(issued.token)).toEqual({
        v: 1,
        eid: environmentId,
        pid: projectId,
        pi: providerInstanceId,
        pd: provider.driver,
        nid: nativeThreadId,
        iat: 1_000_000,
        exp: 1_600_000,
      });
    }).pipe(Effect.provide(tokenLayer)),
  );

  it.effect("rejects a tampered token without echoing it", () =>
    Effect.gen(function* () {
      const codec = yield* CandidateToken.ExternalThreadImportCandidateTokenCodec;
      const issued = yield* codec.issue({ ...scope, nativeThreadId });
      const tampered = `${issued.token.slice(0, -1)}${issued.token.endsWith("a") ? "b" : "a"}`;
      const error = yield* Effect.flip(codec.verify(tampered, scope));

      expect(error._tag).toBe("ExternalThreadImportCandidateTokenInvalidSignatureError");
      expect(error.message).not.toContain(tampered);
      expect(Object.values(error)).not.toContain(tampered);
    }).pipe(Effect.provide(tokenLayer)),
  );

  it.effect("rejects an expired token", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000_000);
      const codec = yield* CandidateToken.ExternalThreadImportCandidateTokenCodec;
      const issued = yield* codec.issue({ ...scope, nativeThreadId });
      yield* TestClock.adjust("10 minutes");
      const error = yield* Effect.flip(codec.verify(issued.token, scope));

      expect(error._tag).toBe("ExternalThreadImportCandidateTokenExpiredError");
    }).pipe(Effect.provide(tokenLayer)),
  );

  it.effect("accepts issue times within the clock skew tolerance", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(2_000_000);
      const codec = yield* CandidateToken.ExternalThreadImportCandidateTokenCodec;
      const issued = yield* codec.issue({ ...scope, nativeThreadId });
      yield* TestClock.setTime(1_970_000);
      const verified = yield* codec.verify(issued.token, scope);

      expect(verified).toEqual({ ...scope, nativeThreadId });
    }).pipe(Effect.provide(tokenLayer)),
  );

  it.effect("rejects issue times beyond the clock skew tolerance", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(2_000_000);
      const codec = yield* CandidateToken.ExternalThreadImportCandidateTokenCodec;
      const issued = yield* codec.issue({ ...scope, nativeThreadId });
      yield* TestClock.setTime(1_969_999);
      const error = yield* Effect.flip(codec.verify(issued.token, scope));

      expect(error._tag).toBe("ExternalThreadImportCandidateTokenNotYetValidError");
    }).pipe(Effect.provide(tokenLayer)),
  );

  it.effect("rejects the wrong environment, project, or provider scope deterministically", () =>
    Effect.gen(function* () {
      const codec = yield* CandidateToken.ExternalThreadImportCandidateTokenCodec;
      const issued = yield* codec.issue({ ...scope, nativeThreadId });
      const mismatches = [
        { ...scope, environmentId: EnvironmentId.make("environment-2") },
        { ...scope, projectId: ProjectId.make("project-2") },
        {
          ...scope,
          provider: { ...provider, instanceId: ProviderInstanceId.make("claude_work") },
        },
        {
          ...scope,
          provider: { ...provider, driver: ProviderDriverKind.make("claudeAgent") },
        },
      ];

      for (const mismatch of mismatches) {
        const error = yield* Effect.flip(codec.verify(issued.token, mismatch));
        expect(error._tag).toBe("ExternalThreadImportCandidateTokenScopeMismatchError");
      }
    }).pipe(Effect.provide(tokenLayer)),
  );

  it.effect("rejects non-canonical signature encodings", () =>
    Effect.gen(function* () {
      const codec = yield* CandidateToken.ExternalThreadImportCandidateTokenCodec;
      const issued = yield* codec.issue({ ...scope, nativeThreadId });
      const [payload, signature] = issued.token.split(".");
      if (!payload || !signature) throw new Error("expected signed token");
      const variants = [
        `${payload}.${signature}=`,
        `${payload}.${signature} `,
        `${payload}.${signature.slice(0, -1)}!`,
        `${payload}.${signature}suffix`,
      ];

      for (const token of variants) {
        const error = yield* Effect.flip(codec.verify(token, scope));
        expect(error._tag).toBe("ExternalThreadImportCandidateTokenInvalidSignatureError");
      }
    }).pipe(Effect.provide(tokenLayer)),
  );

  it.effect("rejects unsupported versions after authenticating the payload", () =>
    Effect.gen(function* () {
      const codec = yield* CandidateToken.ExternalThreadImportCandidateTokenCodec;
      const issued = yield* codec.issue({ ...scope, nativeThreadId });
      const claims = { ...decodePayload(issued.token), v: 2 };
      const encodedPayload = base64UrlEncode(encodeUnknownJson(claims));
      const secretStore = yield* ServerSecretStore.ServerSecretStore;
      const secret = yield* secretStore.getOrCreateRandom(
        "external-thread-import-candidate-signing-key",
        32,
      );
      const token = `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
      const error = yield* Effect.flip(codec.verify(token, scope));

      expect(error._tag).toBe("ExternalThreadImportCandidateTokenUnsupportedVersionError");
      if (error._tag !== "ExternalThreadImportCandidateTokenUnsupportedVersionError") {
        throw new Error("expected unsupported version error");
      }
      expect(error.version).toBe(2);
    }).pipe(Effect.provide(tokenAndSecretLayer)),
  );

  it.effect("rejects malformed and oversized tokens without echoing input", () =>
    Effect.gen(function* () {
      const codec = yield* CandidateToken.ExternalThreadImportCandidateTokenCodec;
      const inputs = ["credential=secret-value", "x".repeat(CandidateToken.MAX_TOKEN_LENGTH + 1)];

      for (const input of inputs) {
        const error = yield* Effect.flip(codec.verify(input, scope));
        expect(error._tag).toBe("ExternalThreadImportCandidateTokenMalformedError");
        expect(error.message).not.toContain(input);
        expect(Object.values(error)).not.toContain(input);
      }
    }).pipe(Effect.provide(tokenLayer)),
  );
});
