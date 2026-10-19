import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import * as ForgeGraphCredentials from "./ForgeGraphCredentials.ts";

const NO_REDIRECT: RequestInit = { redirect: "manual" };
const TIMEOUT = Duration.seconds(30);

/** Why a request failed, as far as a caller acts on it, in the provider ports' vocabulary. */
export const ForgeGraphApiFailure = Schema.Literals([
  "unauthenticated",
  "rate-limited",
  "not-found",
  "failed",
]);

export class ForgeGraphApiError extends Schema.TaggedError<ForgeGraphApiError>()(
  "ForgeGraphApiError",
  {
    operation: Schema.String,
    /** ForgeGraph's HTTP status; null when no answer arrived. */
    status: Schema.NullOr(Schema.Int),
    reason: ForgeGraphApiFailure,
    /** ForgeGraph's machine-readable error code, e.g. `stale_head` or `authorization_pending`. */
    code: Schema.NullOr(Schema.String),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `ForgeGraph ${this.operation} failed: ${this.detail}`;
  }
}

export interface ForgeGraphApiRequest {
  readonly operation: string;
  readonly method?: "GET" | "POST" | "DELETE";
  /** Below `/api`, query string included, e.g. `/fg/prs/<id>`. */
  readonly path: string;
  readonly body?: unknown;
  /** False for the device-flow endpoints, which are called before there is a token. */
  readonly authenticated?: boolean;
}

/** ForgeGraph's HTTP API on the configured server, with the `ForgeGraphCredentials` token. */
export class ForgeGraphApi extends Context.Service<
  ForgeGraphApi,
  {
    /** The server requests go to, for building web URLs. */
    readonly server: Effect.Effect<string>;
    /** The body of a successful answer. */
    readonly request: (input: ForgeGraphApiRequest) => Effect.Effect<string, ForgeGraphApiError>;
  }
>()("@t3tools/source-control-forgegraph/server/ForgeGraphApi") {}

/** ForgeGraph's error body: `{ error, code?, details? }`. */
const decodeProblem = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ error: Schema.optional(Schema.String), code: Schema.optional(Schema.String) }),
  ),
);

const reasonForStatus = (status: number): typeof ForgeGraphApiFailure.Type =>
  status === 401
    ? "unauthenticated"
    : status === 429
      ? "rate-limited"
      : status === 404
        ? "not-found"
        : "failed";

const MAX_PROBLEM_TEXT = 300;
const CODE = /^[a-z][a-z0-9_]{0,63}$/u;

const boundedText = (text: string | undefined) => {
  const line = text?.replace(/\s+/gu, " ").trim();
  if (!line) return undefined;
  return line.length > MAX_PROBLEM_TEXT ? `${line.slice(0, MAX_PROBLEM_TEXT)}…` : line;
};

/**
 * A bounded machine code from an error body. The device flow writes its code as `error`, as
 * RFC 8628 does, and every other route writes `code` beside a sentence.
 */
function problemCode(problem: {
  readonly error?: string | undefined;
  readonly code?: string | undefined;
}): string | null {
  const code = problem.code ?? problem.error;
  return code !== undefined && CODE.test(code) ? code : null;
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const credentials = yield* ForgeGraphCredentials.ForgeGraphCredentials;

  const request = Effect.fn("ForgeGraphApi.request")(function* (input: ForgeGraphApiRequest) {
    const fail = (
      fields: Pick<ForgeGraphApiError, "status" | "reason" | "detail"> & {
        readonly code?: string | null;
        readonly cause?: unknown;
      },
    ) =>
      new ForgeGraphApiError({
        operation: input.operation,
        status: fields.status,
        reason: fields.reason,
        code: fields.code ?? null,
        detail: fields.detail,
        ...(fields.cause === undefined ? {} : { cause: fields.cause }),
      });
    yield* Effect.annotateCurrentSpan({
      "forgegraph.operation": input.operation,
      "http.request.method": input.method ?? "GET",
    });
    const authenticated = input.authenticated !== false;
    const credential = authenticated
      ? yield* credentials.get.pipe(
          Effect.mapError((cause) =>
            fail({ status: null, reason: "unauthenticated", detail: cause.message, cause }),
          ),
        )
      : null;
    const server = credential?.server ?? (yield* credentials.server);
    const base = HttpClientRequest.make(input.method ?? "GET")(`${server}/api${input.path}`).pipe(
      HttpClientRequest.setHeaders({ accept: "application/json", "user-agent": "t3code" }),
    );
    const authorized =
      credential === null
        ? base
        : base.pipe(HttpClientRequest.bearerToken(Redacted.value(credential.token)));
    const { status, text } = yield* Effect.gen(function* () {
      const response = yield* httpClient
        .execute(
          input.body === undefined
            ? authorized
            : authorized.pipe(HttpClientRequest.bodyJsonUnsafe(input.body)),
        )
        .pipe(
          // The client's own span would record the query string, which can carry branch names.
          Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
          // fetch would follow a redirect and keep the bearer token on a same-origin hop; the API
          // answers what it serves directly, so a 3xx is a failure.
          Effect.provideService(FetchHttpClient.RequestInit, NO_REDIRECT),
        );
      return { status: response.status, text: yield* response.text };
    }).pipe(
      Effect.timeout(TIMEOUT),
      Effect.mapError((cause) =>
        fail({ status: null, reason: "failed", detail: `Could not reach ${server}.`, cause }),
      ),
    );
    yield* Effect.annotateCurrentSpan({ "http.response.status_code": status });
    if (status >= 200 && status < 300) return text;
    // The forge CLI may hold a newer token than the one that was refused.
    if (status === 401 && credential?.source === "forge-cli") yield* credentials.invalidate;
    const problem = Option.getOrUndefined(decodeProblem(text));
    return yield* fail({
      status,
      reason: reasonForStatus(status),
      code: problem === undefined ? null : problemCode(problem),
      detail:
        status === 401
          ? "ForgeGraph refused the token. Sign in again from Settings → Source Control."
          : (boundedText(problem?.error) ?? `ForgeGraph answered HTTP ${status}.`),
    });
  });

  return ForgeGraphApi.of({ server: credentials.server, request });
});

export const layer = Layer.effect(ForgeGraphApi, make);
