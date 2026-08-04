import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { EXTERNAL_THREAD_IMPORT_MAX_OPAQUE_VALUE_LENGTH } from "./externalThreadImport.ts";

export const PROJECT_SESSION_IMPORT_MAX_PAGE_SIZE = 200;

export const ProjectSessionImportScanCursor = TrimmedNonEmptyString.check(
  Schema.isMaxLength(EXTERNAL_THREAD_IMPORT_MAX_OPAQUE_VALUE_LENGTH),
).pipe(Schema.brand("ProjectSessionImportScanCursor"));
export type ProjectSessionImportScanCursor = typeof ProjectSessionImportScanCursor.Type;

export const ProjectSessionImportScanInput = Schema.Struct({
  environmentId: EnvironmentId,
  root: TrimmedNonEmptyString,
  cursor: Schema.optional(ProjectSessionImportScanCursor),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SESSION_IMPORT_MAX_PAGE_SIZE)),
});
export type ProjectSessionImportScanInput = typeof ProjectSessionImportScanInput.Type;

export const ProjectSessionImportRepository = Schema.Struct({
  root: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type ProjectSessionImportRepository = typeof ProjectSessionImportRepository.Type;

export const ProjectSessionImportScanResult = Schema.Struct({
  repositories: Schema.Array(ProjectSessionImportRepository),
  scannedDirectoryCount: NonNegativeInt,
  nextCursor: Schema.optional(ProjectSessionImportScanCursor),
});
export type ProjectSessionImportScanResult = typeof ProjectSessionImportScanResult.Type;

export class ProjectSessionImportRequestError extends Schema.TaggedErrorClass<ProjectSessionImportRequestError>()(
  "ProjectSessionImportRequestError",
  {
    code: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
    retryable: Schema.optional(Schema.Boolean),
  },
) {}
