import {
  ProjectId,
  PROJECT_NOTES_MAX_LENGTH,
  ProjectKnowledgeError,
  ProjectKnowledgeNotes,
  type ProjectKnowledgeSearchInput,
  type ProjectKnowledgeSearchResult,
  type ProjectKnowledgeReadInput,
  type ProjectKnowledgePassage,
  type ProjectKnowledgeSaveNotesInput,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Hex from "effect/encoding/Hex";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as WorkspaceEntries from "../workspace/WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "../workspace/WorkspaceFileSystem.ts";
import * as ProjectService from "./ProjectService.ts";
import * as ProjectKnowledgeVectors from "./ProjectKnowledgeVectors.ts";

export class ProjectKnowledge extends Context.Service<
  ProjectKnowledge,
  {
    readonly search: (
      input: ProjectKnowledgeSearchInput,
    ) => Effect.Effect<ProjectKnowledgeSearchResult, ProjectKnowledgeError>;
    readonly read: (
      input: ProjectKnowledgeReadInput,
    ) => Effect.Effect<ProjectKnowledgePassage, ProjectKnowledgeError>;
    readonly getNotes: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectKnowledgeNotes, ProjectKnowledgeError>;
    readonly saveNotes: (
      input: ProjectKnowledgeSaveNotesInput,
    ) => Effect.Effect<ProjectKnowledgeNotes, ProjectKnowledgeError>;
  }
>()("t3/project/ProjectKnowledge") {}

const error = (code: ProjectKnowledgeError["code"], message: string) =>
  new ProjectKnowledgeError({ code, message });
const documentPath = (value: string) =>
  value.startsWith("docs/") &&
  !value.includes("\\") &&
  !value.includes(":") &&
  !value.includes("\0") &&
  !value.split("/").some((part) => part === ".." || part === "." || part === "") &&
  /\.(md|mdx|txt|rst|adoc)$/i.test(value);

const passage = (
  source: "docs" | "notes",
  path: string,
  text: string,
  startLine: number,
  lineCount: number,
  fileTruncated = false,
): ProjectKnowledgePassage => {
  const lines = text.split(/\r?\n/);
  const selected = lines.slice(startLine - 1, startLine - 1 + lineCount);
  const joined = selected.join("\n");
  const content = joined.slice(0, 12000);
  const endLine = startLine + content.split("\n").length - 1;
  return {
    source,
    path,
    startLine,
    endLine,
    ...(endLine < lines.length ? { nextStartLine: endLine + 1 } : {}),
    content,
    truncated:
      fileTruncated ||
      joined.length > content.length ||
      startLine - 1 + selected.length < lines.length,
  };
};

const decodeNotes = Schema.decodeUnknownEffect(Schema.fromJsonString(ProjectKnowledgeNotes));
const encodeNotes = Schema.encodeEffect(Schema.fromJsonString(ProjectKnowledgeNotes));

const make = Effect.gen(function* () {
  const projects = yield* ProjectService.ProjectService;
  const vectors = yield* ProjectKnowledgeVectors.ProjectKnowledgeVectors;
  const entries = yield* WorkspaceEntries.WorkspaceEntries;
  const files = yield* WorkspaceFileSystem.WorkspaceFileSystem;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Digest.Digest;
  const config = yield* ServerConfig.ServerConfig;
  const locks = yield* KeyedLock.make<ProjectId>();
  const notesDirectory = path.join(config.stateDir, "project-knowledge");
  const unavailable = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Project knowledge operation failed", { cause }).pipe(
          Effect.andThen(
            Effect.fail(error("unavailable", "Project knowledge is unavailable. Try again.")),
          ),
        ),
      ),
    );
  const root = Effect.fn("ProjectKnowledge.root")(function* (projectId: ProjectId) {
    const project = yield* unavailable(projects.getById(projectId));
    if (Option.isNone(project))
      return yield* error("project_not_found", "The project was not found.");
    return project.value.workspaceRoot;
  });
  const docsRoot = Effect.fn("ProjectKnowledge.docsRoot")(function* (workspaceRoot: string) {
    const docs = path.join(workspaceRoot, "docs");
    if (!(yield* unavailable(fs.exists(docs)))) return null;
    const [realRoot, realDocs] = yield* unavailable(
      Effect.all([fs.realPath(workspaceRoot), fs.realPath(docs)]),
    );
    const relative = path.relative(realRoot, realDocs);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      return yield* error("invalid_request", "The docs folder must be inside the project.");
    return realDocs;
  });
  const notesPath = Effect.fn("ProjectKnowledge.notesPath")(function* (projectId: ProjectId) {
    const digest = yield* unavailable(
      crypto.digest(Digest.sha256, new TextEncoder().encode(projectId)),
    );
    return path.join(notesDirectory, `${Hex.encode(digest)}.json`);
  });
  const loadNotes = Effect.fn("ProjectKnowledge.loadNotes")(function* (projectId: ProjectId) {
    const filename = yield* notesPath(projectId);
    if (!(yield* unavailable(fs.exists(filename)))) return { content: "", revision: 0 };
    const stat = yield* unavailable(fs.stat(filename));
    if (Number(stat.size) > 100000)
      return yield* error("unavailable", "Saved project notes could not be read.");
    return yield* unavailable(fs.readFileString(filename).pipe(Effect.flatMap(decodeNotes)));
  });
  const readDoc = Effect.fn("ProjectKnowledge.readDoc")(function* (docs: string, filename: string) {
    if (!documentPath(filename))
      return yield* error("invalid_request", "Choose a text document under docs/.");
    return yield* unavailable(files.readFile({ cwd: docs, relativePath: filename.slice(5) }));
  });
  const getNotes = Effect.fn("ProjectKnowledge.getNotes")(function* (projectId: ProjectId) {
    yield* root(projectId);
    return yield* loadNotes(projectId);
  });
  const read = Effect.fn("ProjectKnowledge.read")(function* (input: ProjectKnowledgeReadInput) {
    const workspaceRoot = yield* root(input.projectId);
    const startLine = input.startLine ?? 1;
    const count = input.lineCount ?? 80;
    if (
      !Number.isSafeInteger(startLine) ||
      startLine < 1 ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 200
    )
      return yield* error(
        "invalid_request",
        "Choose up to 200 lines starting at a positive line number.",
      );
    if (input.source === "notes") {
      const notes = yield* loadNotes(input.projectId);
      if (startLine > notes.content.split(/\r?\n/).length)
        return yield* error(
          "invalid_request",
          "The requested line no longer exists. Search again.",
        );
      return passage("notes", "project-notes.md", notes.content, startLine, count);
    }
    const docs = yield* docsRoot(workspaceRoot);
    if (docs === null) return yield* error("invalid_request", "This project has no docs folder.");
    const file = yield* readDoc(docs, input.path);
    if (startLine > file.contents.split(/\r?\n/).length)
      return yield* error("invalid_request", "The requested line is unavailable. Search again.");
    return passage("docs", input.path, file.contents, startLine, count, file.truncated);
  });
  const literalSearch = Effect.fn("ProjectKnowledge.literalSearch")(function* (
    input: ProjectKnowledgeSearchInput,
  ) {
    const workspaceRoot = yield* root(input.projectId);
    const query = input.query.trim();
    const limit = input.limit ?? 20;
    if (!query || query.length > 256 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      return yield* error(
        "invalid_request",
        "Use a query of 1–256 characters and a limit of 1–50.",
      );
    const needle = query.toLocaleLowerCase();
    const notes = yield* loadNotes(input.projectId);
    const matches: ProjectKnowledgePassage[] = [];
    for (const [index, line] of notes.content.split(/\r?\n/).entries()) {
      if (line.toLocaleLowerCase().includes(needle))
        matches.push({
          source: "notes",
          path: "project-notes.md",
          startLine: index + 1,
          endLine: index + 1,
          content: line.slice(0, 1000),
          truncated: line.length > 1000,
        });
      if (matches.length > limit) break;
    }
    const docs = yield* docsRoot(workspaceRoot);
    let truncated = matches.length > limit;
    if (docs !== null && matches.length <= limit) {
      const found = yield* unavailable(
        entries.searchContents({
          cwd: docs,
          query,
          limit: 500,
          caseSensitive: false,
          wholeWord: false,
          useRegex: false,
        }),
      );
      truncated ||= found.truncated;
      const cache = new Map<string, readonly string[] | null>();
      let bytesRead = 0;
      for (const hit of found.matches) {
        const filename = `docs/${hit.path}`;
        if (!documentPath(filename)) continue;
        // Re-read through the containment-checked reader: index snippets can outlive edits or symlinks.
        if (!cache.has(filename)) {
          if (cache.size >= 32 || bytesRead >= 8 * 1024 * 1024) {
            truncated = true;
            break;
          }
          const file = yield* readDoc(docs, filename).pipe(Effect.orElseSucceed(() => null));
          bytesRead += file?.byteLength ?? 0;
          cache.set(filename, file?.contents.split(/\r?\n/) ?? null);
          truncated ||= file?.truncated ?? false;
        }
        const lines = cache.get(filename);
        if (!lines) continue;
        const line = lines[hit.lineNumber - 1];
        if (line === undefined || !line.toLocaleLowerCase().includes(needle)) continue;
        matches.push({
          source: "docs",
          path: filename,
          startLine: hit.lineNumber,
          endLine: hit.lineNumber,
          content: line.slice(0, 1000),
          truncated: line.length > 1000,
        });
        if (matches.length > limit) {
          truncated = true;
          break;
        }
      }
    }
    return { matches: matches.slice(0, limit), truncated, docsAvailable: docs !== null };
  });
  const search = Effect.fn("ProjectKnowledge.search")(function* (
    input: ProjectKnowledgeSearchInput,
  ) {
    const literal = yield* literalSearch(input);
    const semantic = yield* Effect.gen(function* () {
      const fingerprint = yield* vectors.fingerprint;
      const workspaceRoot = yield* root(input.projectId);
      const docs = yield* docsRoot(workspaceRoot);
      const notes = yield* loadNotes(input.projectId);
      const passages: ProjectKnowledgePassage[] = [];
      let truncated = false;
      const chunk = (source: "docs" | "notes", filename: string, text: string) => {
        const lines = text.split(/\r?\n/);
        for (let start = 0; start < lines.length;) {
          if (passages.length >= 5000) {
            truncated = true;
            break;
          }
          let end = start;
          let length = 0;
          while (
            end < lines.length &&
            end - start < 24 &&
            (end === start || length + lines[end]!.length + 1 <= 2000)
          ) {
            length += lines[end]!.length + 1;
            end++;
          }
          const content = lines.slice(start, end).join("\n");
          if (content.trim())
            passages.push({
              source,
              path: filename,
              startLine: start + 1,
              endLine: end,
              content: content.slice(0, 2000),
              truncated: content.length > 2000,
            });
          start = end;
        }
      };
      chunk("notes", "project-notes.md", notes.content);
      if (docs !== null) {
        // Refresh paths before indexing so additions and deletions are observed on this search.
        yield* entries.refresh(docs);
        const listed = yield* entries.list({ cwd: docs });
        truncated ||= listed.truncated;
        let bytesRead = 0;
        let filesRead = 0;
        for (const entry of [...listed.entries].sort((a, b) => a.path.localeCompare(b.path))) {
          const filename = `docs/${entry.path}`;
          if (entry.kind !== "file" || !documentPath(filename)) continue;
          if (filesRead >= 1000 || bytesRead >= 16 * 1024 * 1024 || passages.length >= 5000) {
            truncated = true;
            break;
          }
          const file = yield* readDoc(docs, filename).pipe(Effect.orElseSucceed(() => null));
          filesRead++;
          if (!file) continue;
          bytesRead += file.byteLength;
          truncated ||= file.truncated;
          chunk("docs", filename, file.contents);
        }
      }
      const ranked = yield* vectors.rank({
        projectId: input.projectId,
        fingerprint,
        query: input.query.trim(),
        passages,
        limit: input.limit ?? 20,
      });
      return { ...ranked, truncated };
    }).pipe(Effect.result);
    if (semantic._tag === "Failure")
      return { ...(yield* literalSearch(input)), retrieval: "literal" as const };
    // Reciprocal rank fusion retains exact identifier matches alongside semantic results.
    const fused = new Map<string, { hit: ProjectKnowledgePassage; score: number }>();
    for (const list of [literal.matches, semantic.success.matches])
      for (const [rank, hit] of list.entries()) {
        const key = `${hit.source}:${hit.path}:${hit.startLine}`;
        const previous = fused.get(key);
        fused.set(key, {
          hit: previous?.hit ?? hit,
          score: (previous?.score ?? 0) + 1 / (60 + rank),
        });
      }
    const limit = input.limit ?? 20;
    const docs = yield* docsRoot(yield* root(input.projectId));
    const current: ProjectKnowledgePassage[] = [];
    const sourceCache = new Map<string, string | null>();
    // Recheck all returned citations after embedding, including literal matches collected before indexing.
    for (const { hit } of [...fused.values()].sort((a, b) => b.score - a.score)) {
      if (!sourceCache.has(hit.path))
        sourceCache.set(
          hit.path,
          hit.source === "notes"
            ? (yield* loadNotes(input.projectId)).content
            : docs === null
              ? null
              : ((yield* readDoc(docs, hit.path).pipe(Effect.orElseSucceed(() => null)))
                  ?.contents ?? null),
        );
      const text = sourceCache.get(hit.path);
      if (text === null || text === undefined) continue;
      const selected = text
        .split(/\r?\n/)
        .slice(hit.startLine - 1, hit.endLine)
        .join("\n");
      if ((hit.truncated ? selected.slice(0, hit.content.length) : selected) === hit.content)
        current.push(hit);
      if (current.length >= limit) break;
    }
    return {
      matches: current,
      indexingIncomplete: semantic.success.indexingIncomplete,
      docsAvailable: literal.docsAvailable,
      truncated: literal.truncated || semantic.success.truncated || fused.size > limit,
      retrieval: "hybrid" as const,
    };
  });
  const saveNotes = Effect.fn("ProjectKnowledge.saveNotes")(
    (input: ProjectKnowledgeSaveNotesInput) =>
      locks.withLock(
        input.projectId,
        Effect.gen(function* () {
          yield* root(input.projectId);
          if (
            input.content.length > PROJECT_NOTES_MAX_LENGTH ||
            !Number.isSafeInteger(input.expectedRevision) ||
            input.expectedRevision < 0
          )
            return yield* error(
              "invalid_request",
              "Notes must be at most 16,000 characters with a valid revision.",
            );
          const current = yield* loadNotes(input.projectId);
          if (current.revision !== input.expectedRevision)
            return yield* error(
              "conflict",
              "Project notes changed. Reload them before saving; your draft has been kept.",
            );
          const next = { content: input.content, revision: current.revision + 1 };
          const filename = yield* notesPath(input.projectId);
          const temporary = `${filename}.pending`;
          const json = yield* unavailable(encodeNotes(next));
          yield* unavailable(
            Effect.uninterruptible(
              Effect.gen(function* () {
                yield* fs.makeDirectory(notesDirectory, { recursive: true });
                yield* fs.writeFileString(temporary, json, { mode: 0o600 });
                yield* fs.rename(temporary, filename);
              }).pipe(Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore))),
            ),
          );
          return next;
        }),
      ),
  );
  return ProjectKnowledge.of({ search, read, getNotes, saveNotes });
});
export const layer = Layer.effect(ProjectKnowledge, make);
