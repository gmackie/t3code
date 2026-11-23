import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

export class KnowledgeEmbeddingError extends Schema.TaggedError<KnowledgeEmbeddingError>()(
  "KnowledgeEmbeddingError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "Project embeddings are unavailable.";
  }
}
export class KnowledgeEmbeddings extends Context.Service<
  KnowledgeEmbeddings,
  {
    readonly fingerprint: Effect.Effect<string, KnowledgeEmbeddingError>;
    readonly embed: (
      texts: readonly string[],
      purpose: "document" | "query",
    ) => Effect.Effect<readonly (readonly number[])[], KnowledgeEmbeddingError>;
  }
>()("t3/project/KnowledgeEmbeddings") {}

const Tags = Schema.Struct({
  models: Schema.Array(Schema.Struct({ name: Schema.String, digest: Schema.String })),
});
const Embeddings = Schema.Struct({ embeddings: Schema.Array(Schema.Array(Schema.Number)) });
const make = Effect.gen(function* () {
  const env = yield* HostProcess.Environment;
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const endpoint = (env.T3CODE_KNOWLEDGE_OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = env.T3CODE_KNOWLEDGE_EMBEDDING_MODEL ?? "nomic-embed-text";
  const fingerprint = Effect.gen(function* () {
    const response = yield* http.get(`${endpoint}/api/tags`);
    const tags = yield* response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Tags)));
    const tag = model.includes(":") ? model : `${model}:latest`;
    const installed = tags.models.find((item) => item.name === model || item.name === tag);
    if (!installed) return yield* new KnowledgeEmbeddingError({ cause: "model_missing" });
    return `ollama-v1:${endpoint.length}:${endpoint}:${model.length}:${model}:${installed.digest}`;
  }).pipe(
    Effect.timeout("2 seconds"),
    Effect.mapError((cause) => new KnowledgeEmbeddingError({ cause })),
  );
  const embed = Effect.fn("KnowledgeEmbeddings.embed")(
    function* (texts: readonly string[], purpose: "document" | "query") {
      const input = texts.map((text) =>
        model.startsWith("nomic-embed-text") ? `search_${purpose}: ${text}` : text,
      );
      const request = yield* HttpClientRequest.bodyJson(
        HttpClientRequest.post(`${endpoint}/api/embed`),
        { model, input, truncate: false, keep_alive: "5m" },
      );
      const response = yield* http.execute(request);
      const result = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Embeddings)),
      );
      if (
        result.embeddings.length !== texts.length ||
        result.embeddings.some(
          (vector) =>
            vector.length === 0 ||
            vector.length > 4096 ||
            vector.some((value) => !Number.isFinite(value)) ||
            !vector.some((value) => value !== 0),
        )
      )
        return yield* new KnowledgeEmbeddingError({ cause: "invalid_vectors" });
      return result.embeddings;
    },
    Effect.timeout("45 seconds"),
    Effect.mapError((cause) => new KnowledgeEmbeddingError({ cause })),
  );
  return KnowledgeEmbeddings.of({ fingerprint, embed });
});
export const layer = Layer.effect(KnowledgeEmbeddings, make).pipe(
  Layer.provide(FetchHttpClient.layer),
);
