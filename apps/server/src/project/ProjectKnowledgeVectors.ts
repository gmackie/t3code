import type { ProjectId, ProjectKnowledgePassage } from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as RcRef from "effect/RcRef";
import * as SqlClient from "effect/sql/SqlClient";
import * as ServerConfig from "../config.ts";
import * as KnowledgeEmbeddings from "./KnowledgeEmbeddings.ts";

export class ProjectKnowledgeVectorError extends Schema.TaggedError<ProjectKnowledgeVectorError>()(
  "ProjectKnowledgeVectorError",
  { cause: Schema.Defect() },
) {}
export class ProjectKnowledgeVectors extends Context.Service<
  ProjectKnowledgeVectors,
  {
    readonly rank: (input: {
      readonly projectId: ProjectId;
      readonly fingerprint: string;
      readonly query: string;
      readonly passages: readonly ProjectKnowledgePassage[];
      readonly limit: number;
    }) => Effect.Effect<
      {
        readonly matches: readonly ProjectKnowledgePassage[];
        readonly indexingIncomplete: boolean;
      },
      ProjectKnowledgeVectorError
    >;
    readonly fingerprint: Effect.Effect<string, KnowledgeEmbeddings.KnowledgeEmbeddingError>;
  }
>()("t3/project/ProjectKnowledgeVectors") {}

const Vector = Schema.Array(Schema.Number);
const encodeVector = Schema.encodeEffect(Schema.fromJsonString(Vector));
const decodeVector = Schema.decodeUnknownEffect(Schema.fromJsonString(Vector));
const normalize = (vector: readonly number[]) => {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm > 0 && Number.isFinite(norm) ? vector.map((value) => value / norm) : null;
};
const make = Effect.gen(function* () {
  const embeddings = yield* KnowledgeEmbeddings.KnowledgeEmbeddings;
  const crypto = yield* Digest.Digest;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const locks = yield* KeyedLock.make<ProjectId>();
  const directory = path.join(config.stateDir, "project-knowledge");
  const database = Layer.unwrap(
    Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true });
      return NodeSqliteClient.layer({
        filename: path.join(directory, "vectors.sqlite"),
        readerWorker: true,
        checkpointWorker: true,
      });
    }),
  );
  const connection = yield* RcRef.make({
    acquire: Layer.build(database),
    idleTimeToLive: "5 minutes",
  });
  const rank = Effect.fn("ProjectKnowledgeVectors.rank")(
    (input: {
      readonly projectId: ProjectId;
      readonly fingerprint: string;
      readonly query: string;
      readonly passages: readonly ProjectKnowledgePassage[];
      readonly limit: number;
    }) =>
      locks.withLock(
        input.projectId,
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`PRAGMA busy_timeout = 5000`;
          yield* sql`PRAGMA journal_mode = WAL`;
          yield* sql`CREATE TABLE IF NOT EXISTS vectors (project TEXT NOT NULL, fingerprint TEXT NOT NULL, digest TEXT NOT NULL, vector TEXT NOT NULL, PRIMARY KEY(project, digest))`;
          const rows = yield* sql<{
            digest: string;
            vector: string;
          }>`SELECT digest, vector FROM vectors WHERE project = ${input.projectId} AND fingerprint = ${input.fingerprint}`;
          const cache = new Map(rows.map((row) => [row.digest, row.vector]));
          const keys = yield* Effect.forEach(input.passages, (item) =>
            crypto
              .digest(Digest.sha256, new TextEncoder().encode(item.content))
              .pipe(Effect.map(Hex.encode)),
          );
          const vectors = new Map<string, readonly number[]>();
          for (const key of new Set(keys)) {
            const raw = cache.get(key);
            if (raw !== undefined) {
              const vector = yield* decodeVector(raw).pipe(Effect.orElseSucceed(() => null));
              const normalized =
                vector && vector.length <= 4096 && vector.every(Number.isFinite)
                  ? normalize(vector)
                  : null;
              if (normalized) vectors.set(key, normalized);
            }
          }
          const missing = [...new Set(keys)].filter((key) => !vectors.has(key));
          const contents = new Map(keys.map((key, index) => [key, input.passages[index]!.content]));
          for (let offset = 0; offset < Math.min(missing.length, 256); offset += 16) {
            const batch = missing.slice(offset, offset + 16);
            const embedded = yield* embeddings.embed(
              batch.map((key) => contents.get(key)!),
              "document",
            );
            for (const [index, key] of batch.entries()) {
              const vector = normalize(embedded[index]!);
              if (!vector)
                return yield* new ProjectKnowledgeVectorError({ cause: "invalid_vector" });
              vectors.set(key, vector);
            }
            // Each successful batch is reusable if a later batch is cancelled or the endpoint fails.
            yield* sql.withTransaction(
              Effect.forEach(
                batch,
                (key) =>
                  Effect.gen(function* () {
                    return yield* sql`INSERT INTO vectors (project, fingerprint, digest, vector) VALUES (${input.projectId}, ${input.fingerprint}, ${key}, ${yield* encodeVector(vectors.get(key)!)}) ON CONFLICT(project, digest) DO UPDATE SET fingerprint = excluded.fingerprint, vector = excluded.vector`;
                  }),
                { discard: true },
              ),
            );
          }
          const query = normalize((yield* embeddings.embed([input.query], "query"))[0]!);
          if (!query || [...vectors.values()].some((vector) => vector.length !== query.length)) {
            yield* sql`DELETE FROM vectors WHERE project = ${input.projectId}`;
            return yield* new ProjectKnowledgeVectorError({ cause: "incompatible_dimensions" });
          }
          // Purge removed documents and old model vectors only after a complete successful refresh.
          const current = new Set(keys);
          yield* sql.withTransaction(
            Effect.gen(function* () {
              const existing = yield* sql<{
                digest: string;
              }>`SELECT digest FROM vectors WHERE project = ${input.projectId}`;
              for (const row of existing)
                if (!current.has(row.digest))
                  yield* sql`DELETE FROM vectors WHERE project = ${input.projectId} AND digest = ${row.digest}`;
            }),
          );
          const ranked: { passage: ProjectKnowledgePassage; score: number }[] = [];
          for (const [index, item] of input.passages.entries()) {
            const vector = vectors.get(keys[index]!);
            if (!vector) continue;
            const score = vector.reduce(
              (sum, value, dimension) => sum + value * query[dimension]!,
              0,
            );
            if (score > 0.25) ranked.push({ passage: item, score });
            if (index % 128 === 0) yield* Effect.yieldNow;
          }
          return {
            indexingIncomplete: missing.length > 256,
            matches: ranked
              .sort((a, b) => b.score - a.score)
              .slice(0, input.limit)
              .map((item) => item.passage),
          };
        }).pipe((operation) =>
          RcRef.get(connection).pipe(
            Effect.flatMap((context) => Effect.provide(operation, context)),
            Effect.scoped,
          ),
        ),
      ),
    Effect.mapError((cause) => new ProjectKnowledgeVectorError({ cause })),
  );
  return ProjectKnowledgeVectors.of({ rank, fingerprint: embeddings.fingerprint });
});
export const layer = Layer.effect(ProjectKnowledgeVectors, make);
