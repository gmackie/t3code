import { Schema } from "effect";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_READ_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;
const PROJECT_CODE_SYMBOL_NAME_MAX_LENGTH = 512;

export const ProjectListEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
});
export type ProjectListEntriesInput = typeof ProjectListEntriesInput.Type;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);
export const ProjectEntryGitStatus = Schema.Literals([
  "modified",
  "added",
  "deleted",
  "untracked",
  "renamed",
  "copied",
  "type_changed",
  "conflicted",
]);
export type ProjectEntryGitStatus = typeof ProjectEntryGitStatus.Type;

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
  gitStatus: Schema.optional(ProjectEntryGitStatus),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectEntriesResult = typeof ProjectEntriesResult.Type;

export const ProjectListEntriesResult = ProjectEntriesResult;
export type ProjectListEntriesResult = typeof ProjectListEntriesResult.Type;

export const ProjectSearchEntriesResult = ProjectEntriesResult;
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export class ProjectListEntriesError extends Schema.TaggedErrorClass<ProjectListEntriesError>()(
  "ProjectListEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_READ_FILE_PATH_MAX_LENGTH)),
});
export type ProjectReadFileInput = typeof ProjectReadFileInput.Type;

export const ProjectReadFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
  contents: Schema.String,
});
export type ProjectReadFileResult = typeof ProjectReadFileResult.Type;

export class ProjectReadFileError extends Schema.TaggedErrorClass<ProjectReadFileError>()(
  "ProjectReadFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectCodeIntelligenceSource = Schema.Literals([
  "none",
  "heuristic",
  "typescript",
  "tree_sitter",
  "lsp",
]);
export type ProjectCodeIntelligenceSource = typeof ProjectCodeIntelligenceSource.Type;

export const ProjectCodeSymbolKind = Schema.Literals([
  "heading",
  "class",
  "function",
  "method",
  "interface",
  "enum",
  "type",
  "variable",
  "struct",
  "trait",
  "module",
  "constant",
]);
export type ProjectCodeSymbolKind = typeof ProjectCodeSymbolKind.Type;

const ProjectCodePosition = Schema.Struct({
  line: PositiveInt,
  column: PositiveInt,
});

const ProjectCodeRange = Schema.Struct({
  start: ProjectCodePosition,
  end: ProjectCodePosition,
});

export const ProjectCodeDocumentSymbol = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_CODE_SYMBOL_NAME_MAX_LENGTH)),
  kind: ProjectCodeSymbolKind,
  range: ProjectCodeRange,
  selectionRange: ProjectCodeRange,
});
export type ProjectCodeDocumentSymbol = typeof ProjectCodeDocumentSymbol.Type;

export const ProjectCodeDocumentSymbolsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_READ_FILE_PATH_MAX_LENGTH)),
});
export type ProjectCodeDocumentSymbolsInput = typeof ProjectCodeDocumentSymbolsInput.Type;

export const ProjectCodeDocumentSymbolsResult = Schema.Struct({
  source: ProjectCodeIntelligenceSource,
  symbols: Schema.Array(ProjectCodeDocumentSymbol),
});
export type ProjectCodeDocumentSymbolsResult = typeof ProjectCodeDocumentSymbolsResult.Type;

export class ProjectCodeDocumentSymbolsError extends Schema.TaggedErrorClass<ProjectCodeDocumentSymbolsError>()(
  "ProjectCodeDocumentSymbolsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectCodeHoverInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_READ_FILE_PATH_MAX_LENGTH)),
  line: PositiveInt,
  column: PositiveInt,
});
export type ProjectCodeHoverInput = typeof ProjectCodeHoverInput.Type;

export const ProjectCodeHover = Schema.Struct({
  contents: TrimmedNonEmptyString,
  range: Schema.optional(ProjectCodeRange),
});
export type ProjectCodeHover = typeof ProjectCodeHover.Type;

export const ProjectCodeHoverResult = Schema.Struct({
  source: ProjectCodeIntelligenceSource,
  hover: Schema.NullOr(ProjectCodeHover),
});
export type ProjectCodeHoverResult = typeof ProjectCodeHoverResult.Type;

export class ProjectCodeHoverError extends Schema.TaggedErrorClass<ProjectCodeHoverError>()(
  "ProjectCodeHoverError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectCodeDefinition = Schema.Struct({
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_READ_FILE_PATH_MAX_LENGTH)),
  line: PositiveInt,
  column: PositiveInt,
});
export type ProjectCodeDefinition = typeof ProjectCodeDefinition.Type;

export const ProjectCodeDefinitionsInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_READ_FILE_PATH_MAX_LENGTH)),
  line: PositiveInt,
  column: PositiveInt,
});
export type ProjectCodeDefinitionsInput = typeof ProjectCodeDefinitionsInput.Type;

export const ProjectCodeDefinitionsResult = Schema.Struct({
  source: ProjectCodeIntelligenceSource,
  definitions: Schema.Array(ProjectCodeDefinition),
});
export type ProjectCodeDefinitionsResult = typeof ProjectCodeDefinitionsResult.Type;

export class ProjectCodeDefinitionsError extends Schema.TaggedErrorClass<ProjectCodeDefinitionsError>()(
  "ProjectCodeDefinitionsError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
