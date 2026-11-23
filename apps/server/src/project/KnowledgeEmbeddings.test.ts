import { expect, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as KnowledgeEmbeddings from "./KnowledgeEmbeddings.ts";

it.effect("uses the installed model digest and the correct document/query prefixes", () => {
  const requests: unknown[] = [];
  let digest = "revision-one";
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url.endsWith("/api/tags"))
      return Response.json({ models: [{ name: "nomic-embed-text:latest", digest }] });
    requests.push(await request.json());
    return Response.json({ embeddings: [[0.6, 0.8]] });
  };
  return Effect.gen(function* () {
    const embeddings = yield* KnowledgeEmbeddings.KnowledgeEmbeddings;
    const first = yield* embeddings.fingerprint;
    digest = "revision-two";
    expect(yield* embeddings.fingerprint).not.toBe(first);
    expect(yield* embeddings.embed(["durable receipts"], "document")).toEqual([[0.6, 0.8]]);
    yield* embeddings.embed(["finished work"], "query");
    expect(requests).toEqual([
      {
        model: "nomic-embed-text",
        input: ["search_document: durable receipts"],
        truncate: false,
        keep_alive: "5m",
      },
      {
        model: "nomic-embed-text",
        input: ["search_query: finished work"],
        truncate: false,
        keep_alive: "5m",
      },
    ]);
  }).pipe(
    Effect.provide(KnowledgeEmbeddings.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
  );
});

it.effect("rejects missing models, invalid vectors, count mismatches and failed endpoints", () => {
  let payload: unknown = { models: [] };
  let status = 200;
  const fetch: typeof globalThis.fetch = async () => Response.json(payload, { status });
  return Effect.gen(function* () {
    const embeddings = yield* KnowledgeEmbeddings.KnowledgeEmbeddings;
    expect((yield* Effect.flip(embeddings.fingerprint))._tag).toBe("KnowledgeEmbeddingError");
    for (const vectors of [[], [[]], [[0, 0]], [[1], [2]], [["invalid"]]]) {
      payload = { embeddings: vectors };
      expect((yield* Effect.flip(embeddings.embed(["text"], "query")))._tag).toBe(
        "KnowledgeEmbeddingError",
      );
    }
    status = 503;
    expect((yield* Effect.flip(embeddings.embed(["text"], "document"))).message).toBe(
      "Project embeddings are unavailable.",
    );
  }).pipe(
    Effect.provide(KnowledgeEmbeddings.layer),
    Effect.provideService(FetchHttpClient.Fetch, fetch),
    Effect.provideService(HostProcess.Environment, {}),
  );
});
