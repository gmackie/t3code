import * as Schema from "effect/Schema";
import { NonNegativeInt, PositiveInt, ProjectId } from "./baseSchemas.ts";

export const PROJECT_NOTES_MAX_LENGTH = 16000;
export const ProjectKnowledgeTarget = Schema.Struct({ projectId: ProjectId });
export type ProjectKnowledgeTarget = typeof ProjectKnowledgeTarget.Type;
export const ProjectKnowledgeSearchInput = Schema.Struct({
  projectId: ProjectId,
  query: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(50))),
});
export type ProjectKnowledgeSearchInput = typeof ProjectKnowledgeSearchInput.Type;
export const ProjectKnowledgeSource = Schema.Literals(["docs", "notes"]);
export const ProjectKnowledgePassage = Schema.Struct({
  source: ProjectKnowledgeSource,
  path: Schema.String,
  startLine: PositiveInt,
  endLine: PositiveInt,
  content: Schema.String,
  truncated: Schema.Boolean,
  nextStartLine: Schema.optional(PositiveInt),
});
export type ProjectKnowledgePassage = typeof ProjectKnowledgePassage.Type;
export const ProjectKnowledgeSearchResult = Schema.Struct({
  matches: Schema.Array(ProjectKnowledgePassage),
  truncated: Schema.Boolean,
  docsAvailable: Schema.Boolean,
  indexingIncomplete: Schema.optional(Schema.Boolean),
  retrieval: Schema.optional(Schema.Literals(["hybrid", "literal"])),
});
export type ProjectKnowledgeSearchResult = typeof ProjectKnowledgeSearchResult.Type;
export const ProjectKnowledgeReadInput = Schema.Struct({
  projectId: ProjectId,
  source: ProjectKnowledgeSource,
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  startLine: Schema.optional(PositiveInt),
  lineCount: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(200))),
});
export type ProjectKnowledgeReadInput = typeof ProjectKnowledgeReadInput.Type;
export const ProjectKnowledgeNotes = Schema.Struct({
  content: Schema.String.check(Schema.isMaxLength(PROJECT_NOTES_MAX_LENGTH)),
  revision: NonNegativeInt,
});
export type ProjectKnowledgeNotes = typeof ProjectKnowledgeNotes.Type;
export const ProjectKnowledgeSaveNotesInput = Schema.Struct({
  projectId: ProjectId,
  content: ProjectKnowledgeNotes.fields.content,
  expectedRevision: NonNegativeInt,
});
export type ProjectKnowledgeSaveNotesInput = typeof ProjectKnowledgeSaveNotesInput.Type;
export class ProjectKnowledgeError extends Schema.TaggedError<ProjectKnowledgeError>()(
  "ProjectKnowledgeError",
  {
    code: Schema.Literals(["invalid_request", "project_not_found", "conflict", "unavailable"]),
    message: Schema.String,
  },
) {}
