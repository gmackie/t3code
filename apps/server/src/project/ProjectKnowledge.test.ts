import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, expect } from "@effect/vitest";
import { symlinksSupported } from "@t3tools/shared/testing/symlinks";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as ServerConfig from "../config.ts";
import * as KnownWorkspaces from "../workspace/KnownWorkspaces.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProjectKnowledge from "./ProjectKnowledge.ts";
import * as ProjectKnowledgeVectors from "./ProjectKnowledgeVectors.ts";
import * as KnowledgeEmbeddings from "./KnowledgeEmbeddings.ts";

const first = ProjectId.make("project:../../first");
const second = ProjectId.make("project:second");
const offlineEmbeddings = KnowledgeEmbeddings.KnowledgeEmbeddings.of({
  fingerprint: Effect.fail(new KnowledgeEmbeddings.KnowledgeEmbeddingError({ cause: "offline" })),
  embed: () => Effect.fail(new KnowledgeEmbeddings.KnowledgeEmbeddingError({ cause: "offline" })),
});
const harness = (embeddingService = offlineEmbeddings) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const base = yield* fs.makeTempDirectoryScoped({ prefix: "t3-knowledge-" });
    const roots = new Map([
      [first, path.join(base, "first")],
      [second, path.join(base, "second")],
    ]);
    for (const root of roots.values())
      yield* fs.makeDirectory(path.join(root, "docs"), { recursive: true });
    const layerEntries = WorkspaceEntries.layer.pipe(Layer.provide(WorkspacePaths.layer));
    const layer = ProjectKnowledge.layer.pipe(
      Layer.provideMerge(layerEntries),
      Layer.provide(
        ProjectKnowledgeVectors.layer.pipe(
          Layer.provide(Layer.succeed(KnowledgeEmbeddings.KnowledgeEmbeddings, embeddingService)),
        ),
      ),
      Layer.provide(
        WorkspaceFileSystem.layer.pipe(
          Layer.provide(layerEntries),
          Layer.provide(WorkspacePaths.layer),
          Layer.provide(
            Layer.mock(KnownWorkspaces.KnownWorkspaces)({ assertContains: () => Effect.void }),
          ),
        ),
      ),
      Layer.provide(
        Layer.mock(ProjectService.ProjectService)({
          getById: (id) =>
            Effect.succeed(
              Option.fromNullishOr(
                roots.has(id)
                  ? {
                      id,
                      title: id,
                      workspaceRoot: roots.get(id)!,
                      defaultModelSelection: null,
                      scripts: [],
                      createdAt: "2026-01-01T00:00:00.000Z",
                      updatedAt: "2026-01-01T00:00:00.000Z",
                      deletedAt: null,
                    }
                  : null,
              ),
            ),
        }),
      ),
      Layer.provide(WorkspacePaths.layer),
      Layer.provide(VcsProcess.layer),
      Layer.provide(ServerConfig.layerTest(base, path.join(base, "state"))),
    );
    return { fs, path, base, roots, layer };
  });

const platform = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);

it.effect("cites docs, reads current source, and keeps projects and non-doc files separate", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const root = h.roots.get(first)!;
    yield* h.fs.writeFileString(
      h.path.join(root, "docs", "architecture.md"),
      "# Design\nA durable reactor owns retries.\nThe third line.",
    );
    yield* h.fs.writeFileString(h.path.join(root, "outside.md"), "reactor outside docs");
    yield* h.fs.writeFileString(h.path.join(root, "docs", "example.ts"), "reactor implementation");
    yield* Effect.gen(function* () {
      const knowledge = yield* ProjectKnowledge.ProjectKnowledge;
      const found = yield* knowledge.search({ projectId: first, query: "reactor" });
      expect(found.matches).toEqual([
        {
          source: "docs",
          path: "docs/architecture.md",
          startLine: 2,
          endLine: 2,
          content: "A durable reactor owns retries.",
          truncated: false,
        },
      ]);
      expect((yield* knowledge.search({ projectId: second, query: "reactor" })).matches).toEqual(
        [],
      );
      yield* h.fs.writeFileString(
        h.path.join(root, "docs", "architecture.md"),
        "# Revised\nA durable reactor owns receipts.",
      );
      const read = yield* knowledge.read({
        projectId: first,
        source: "docs",
        path: "docs/architecture.md",
        startLine: 2,
        lineCount: 1,
      });
      expect(read.content).toBe("A durable reactor owns receipts.");
      expect(read.startLine).toBe(2);
      expect((yield* knowledge.search({ projectId: first, query: "retries" })).matches).toEqual([]);
      yield* h.fs.remove(h.path.join(root, "docs", "architecture.md"));
      expect((yield* knowledge.search({ projectId: first, query: "reactor" })).matches).toEqual([]);
    }).pipe(Effect.provide(h.layer));
  }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect(
  "persists explicit notes, rejects stale concurrent saves, and clears with a new revision",
  () =>
    Effect.gen(function* () {
      const h = yield* harness();
      yield* Effect.gen(function* () {
        const knowledge = yield* ProjectKnowledge.ProjectKnowledge;
        expect(yield* knowledge.getNotes(first)).toEqual({ content: "", revision: 0 });
        const outcomes = yield* Effect.all(
          [
            knowledge
              .saveNotes({ projectId: first, content: "Use receipts.", expectedRevision: 0 })
              .pipe(Effect.result),
            knowledge
              .saveNotes({ projectId: first, content: "Never poll.", expectedRevision: 0 })
              .pipe(Effect.result),
          ],
          { concurrency: "unbounded" },
        );
        expect(outcomes.filter((outcome) => outcome._tag === "Success")).toHaveLength(1);
        expect(outcomes.filter((outcome) => outcome._tag === "Failure")).toHaveLength(1);
        const notes = yield* knowledge.getNotes(first);
        expect(notes.revision).toBe(1);
        expect((yield* knowledge.getNotes(second)).content).toBe("");
        expect(
          (yield* knowledge.search({ projectId: first, query: notes.content })).matches[0]?.source,
        ).toBe("notes");
        expect(
          (yield* Effect.flip(
            knowledge.saveNotes({ projectId: first, content: "stale", expectedRevision: 0 }),
          )).code,
        ).toBe("conflict");
      }).pipe(Effect.provide(h.layer));
      yield* Effect.gen(function* () {
        const knowledge = yield* ProjectKnowledge.ProjectKnowledge;
        expect((yield* knowledge.getNotes(first)).revision).toBe(1);
        expect(
          yield* knowledge.saveNotes({ projectId: first, content: "", expectedRevision: 1 }),
        ).toEqual({ content: "", revision: 2 });
        expect((yield* knowledge.search({ projectId: first, query: "receipts" })).matches).toEqual(
          [],
        );
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect("bounds passages and rejects traversal, symlink escapes, and invalid notes", () =>
  Effect.gen(function* () {
    const h = yield* harness();
    const root = h.roots.get(first)!;
    yield* h.fs.writeFileString(
      h.path.join(root, "docs", "large.md"),
      Array.from({ length: 230 }, (_, index) => `Line ${index}`).join("\n"),
    );
    yield* h.fs.writeFileString(h.path.join(h.base, "secret.md"), "private project text");
    if (symlinksSupported)
      yield* h.fs.symlink(h.path.join(h.base, "secret.md"), h.path.join(root, "docs", "escape.md"));
    yield* Effect.gen(function* () {
      const knowledge = yield* ProjectKnowledge.ProjectKnowledge;
      const read = yield* knowledge.read({
        projectId: first,
        source: "docs",
        path: "docs/large.md",
        startLine: 5,
        lineCount: 200,
      });
      expect(read.startLine).toBe(5);
      expect(read.endLine).toBe(204);
      expect(read.truncated).toBe(true);
      expect(read.nextStartLine).toBe(205);
      expect(
        (yield* Effect.flip(
          knowledge.read({
            projectId: first,
            source: "docs",
            path: "docs/large.md",
            startLine: 240,
          }),
        )).code,
      ).toBe("invalid_request");
      for (const filename of [
        "docs/../outside.md",
        "/secret.md",
        "docs/escape.md",
        "docs/example.ts",
        "docs/C:/secret.md",
        "docs/\\server/secret.md",
      ])
        expect(
          (yield* Effect.flip(knowledge.read({ projectId: first, source: "docs", path: filename })))
            ._tag,
        ).toBe("ProjectKnowledgeError");
      expect(
        (yield* knowledge.search({ projectId: first, query: "private project text" })).matches,
      ).toEqual([]);
      expect(
        (yield* knowledge.search({ projectId: first, query: "Line", limit: 2 })).matches,
      ).toHaveLength(2);
      expect(
        (yield* knowledge.search({ projectId: first, query: "Line", limit: 2 })).truncated,
      ).toBe(true);
      expect(
        (yield* Effect.flip(
          knowledge.saveNotes({
            projectId: first,
            content: "x".repeat(16001),
            expectedRevision: 0,
          }),
        )).code,
      ).toBe("invalid_request");
      expect((yield* Effect.flip(knowledge.search({ projectId: first, query: " " }))).code).toBe(
        "invalid_request",
      );
      expect((yield* Effect.flip(knowledge.getNotes(ProjectId.make("missing")))).code).toBe(
        "project_not_found",
      );
      yield* h.fs.remove(h.path.join(root, "docs"), { recursive: true });
      expect((yield* knowledge.search({ projectId: first, query: "anything" })).docsAvailable).toBe(
        false,
      );
      if (!symlinksSupported) return;
      yield* h.fs.symlink(h.roots.get(second)!, h.path.join(root, "docs"));
      expect(
        (yield* Effect.flip(knowledge.search({ projectId: first, query: "anything" }))).code,
      ).toBe("invalid_request");
    }).pipe(Effect.provide(h.layer));
  }).pipe(Effect.scoped, Effect.provide(platform)),
);

const vectorFor = (text: string) =>
  /receipt|completion|finished/.test(text)
    ? [1, 0, 0]
    : /login|authentication/.test(text)
      ? [0, 1, 0]
      : [0, 0, 1];
it.effect(
  "retrieves paraphrases, persists vectors, updates changed chunks, and invalidates model changes",
  () =>
    Effect.gen(function* () {
      const embedded: string[] = [];
      let model = "model:v1";
      const embeddings = KnowledgeEmbeddings.KnowledgeEmbeddings.of({
        fingerprint: Effect.sync(() => model),
        embed: (texts, purpose) =>
          Effect.sync(() => {
            if (purpose === "document") embedded.push(...texts);
            return texts.map(vectorFor);
          }),
      });
      const h = yield* harness(embeddings);
      const filename = h.path.join(h.roots.get(first)!, "docs", "reactors.md");
      yield* h.fs.writeFileString(
        filename,
        "# Durable tasks\nUse receipts to confirm reactor work.",
      );
      const lookup = Effect.gen(function* () {
        const knowledge = yield* ProjectKnowledge.ProjectKnowledge;
        const result = yield* knowledge.search({
          projectId: first,
          query: "How is completion confirmed?",
        });
        expect(result.retrieval).toBe("hybrid");
        expect(result.matches[0]).toMatchObject({
          path: "docs/reactors.md",
          startLine: 1,
          endLine: 2,
        });
        expect(
          (yield* knowledge.search({ projectId: second, query: "completion" })).matches,
        ).toEqual([]);
      });
      yield* lookup.pipe(Effect.provide(h.layer));
      expect(embedded).toHaveLength(1);
      yield* lookup.pipe(Effect.provide(h.layer));
      expect(embedded).toHaveLength(1); // New service lifetime reuses the on-disk cache.
      model = "model:v2";
      yield* lookup.pipe(Effect.provide(h.layer));
      expect(embedded).toHaveLength(2);
      yield* h.fs.writeFileString(filename, "Authentication uses login tokens.");
      yield* Effect.gen(function* () {
        const knowledge = yield* ProjectKnowledge.ProjectKnowledge;
        expect(
          (yield* knowledge.search({ projectId: first, query: "completion" })).matches,
        ).toEqual([]);
        expect(
          (yield* knowledge.search({ projectId: first, query: "login" })).matches.length,
        ).toBeGreaterThan(0);
        yield* h.fs.remove(filename);
        expect((yield* knowledge.search({ projectId: first, query: "login" })).matches).toEqual([]);
      }).pipe(Effect.provide(h.layer));
      expect(embedded).toHaveLength(3);
    }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect(
  "revalidates literal and semantic citations when source changes during embedding and falls back when offline",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      let filename = "";
      let offline = false;
      const embeddings = KnowledgeEmbeddings.KnowledgeEmbeddings.of({
        fingerprint: Effect.succeed("model:v1"),
        embed: (texts, purpose) =>
          offline
            ? Effect.fail(new KnowledgeEmbeddings.KnowledgeEmbeddingError({ cause: "offline" }))
            : Effect.gen(function* () {
                if (purpose === "document")
                  yield* fs
                    .writeFileString(filename, "Authentication uses login tokens.")
                    .pipe(Effect.orDie);
                return texts.map(vectorFor);
              }),
      });
      const h = yield* harness(embeddings);
      filename = h.path.join(h.roots.get(first)!, "docs", "changing.md");
      yield* fs.writeFileString(filename, "Use receipts to confirm work.");
      yield* Effect.gen(function* () {
        const knowledge = yield* ProjectKnowledge.ProjectKnowledge;
        expect((yield* knowledge.search({ projectId: first, query: "receipts" })).matches).toEqual(
          [],
        );
        offline = true;
        const fallback = yield* knowledge.search({ projectId: first, query: "login" });
        expect(fallback.retrieval).toBe("literal");
        expect(fallback.matches[0]?.content).toBe("Authentication uses login tokens.");
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.scoped, Effect.provide(platform)),
);

it.effect(
  "continues bounded indexing across searches and never ranks deleted cached passages",
  () =>
    Effect.gen(function* () {
      let embedded = 0;
      const embeddings = KnowledgeEmbeddings.KnowledgeEmbeddings.of({
        fingerprint: Effect.succeed("model:v1"),
        embed: (texts, purpose) =>
          Effect.sync(() => {
            if (purpose === "document") embedded += texts.length;
            return texts.map(() => [1, 0]);
          }),
      });
      const h = yield* harness(embeddings);
      const filename = h.path.join(h.roots.get(first)!, "docs", "large.md");
      yield* h.fs.writeFileString(
        filename,
        Array.from({ length: 257 }, (_, i) => `Passage ${i}: ${"x".repeat(1900)}`).join("\n"),
      );
      yield* Effect.gen(function* () {
        const knowledge = yield* ProjectKnowledge.ProjectKnowledge;
        const firstPass = yield* knowledge.search({ projectId: first, query: "meaning" });
        expect(firstPass.indexingIncomplete).toBe(true);
        expect(embedded).toBe(256);
        const complete = yield* knowledge.search({ projectId: first, query: "meaning" });
        expect(complete.indexingIncomplete).toBe(false);
        expect(embedded).toBe(257);
        yield* h.fs.remove(filename);
        expect((yield* knowledge.search({ projectId: first, query: "meaning" })).matches).toEqual(
          [],
        );
      }).pipe(Effect.provide(h.layer));
    }).pipe(Effect.scoped, Effect.provide(platform)),
);
