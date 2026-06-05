import {
  IssueProviderError,
  ProjectId,
  type LinearIssueValidationResult,
  type ServerSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

const LINEAR_PROJECTS_QUERY = `
  query T3CodeLinearProjects {
    viewer {
      name
      organization {
        name
      }
    }
    projects(first: 100) {
      nodes {
        id
        name
        teams {
          nodes {
            key
            name
          }
        }
      }
    }
  }
`;

const LinearGraphqlTeamNode = Schema.Struct({
  key: Schema.optional(Schema.Unknown),
  name: Schema.optional(Schema.Unknown),
});

const LinearGraphqlProjectNode = Schema.Struct({
  id: Schema.optional(Schema.Unknown),
  name: Schema.optional(Schema.Unknown),
  teams: Schema.optional(
    Schema.Struct({
      nodes: Schema.optional(Schema.Array(LinearGraphqlTeamNode)),
    }),
  ),
});

const LinearGraphqlResponse = Schema.Struct({
  data: Schema.optional(
    Schema.Struct({
      viewer: Schema.optional(
        Schema.Struct({
          name: Schema.optional(Schema.Unknown),
          organization: Schema.optional(
            Schema.Struct({
              name: Schema.optional(Schema.Unknown),
            }),
          ),
        }),
      ),
      projects: Schema.optional(
        Schema.Struct({
          nodes: Schema.optional(Schema.Array(LinearGraphqlProjectNode)),
        }),
      ),
    }),
  ),
  errors: Schema.optional(
    Schema.Array(Schema.Struct({ message: Schema.optional(Schema.Unknown) })),
  ),
});
type LinearGraphqlResponse = typeof LinearGraphqlResponse.Type;

export function normalizeLinearDomain(domain: string): string {
  const trimmed = domain.trim() || "linear.app";
  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/u, "")
    .replace(/^api\./i, "")
    .trim();
}

export function linearGraphqlUrl(domain: string): string {
  return `https://api.${normalizeLinearDomain(domain)}/graphql`;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function errorResult(error: string): LinearIssueValidationResult {
  return {
    ok: false,
    workspaceName: null,
    userName: null,
    projects: [],
    error,
  };
}

function mapLinearResponse(
  response: LinearGraphqlResponse,
  settings: ServerSettings,
): LinearIssueValidationResult {
  const firstError = response.errors?.find((error) => stringOrNull(error.message))?.message;
  if (firstError) {
    return errorResult(String(firstError));
  }

  const mappings = settings.issues.linear.projectMappings;
  const mappedProjectIdsByLinearProjectId = new Map<string, ProjectId[]>();
  for (const [projectId, mapping] of Object.entries(mappings)) {
    const mappedProjectIds = mappedProjectIdsByLinearProjectId.get(mapping.linearProjectId) ?? [];
    mappedProjectIds.push(ProjectId.make(projectId));
    mappedProjectIdsByLinearProjectId.set(mapping.linearProjectId, mappedProjectIds);
  }

  const projects =
    response.data?.projects?.nodes?.flatMap((project) => {
      const id = stringOrNull(project.id);
      const name = stringOrNull(project.name);
      if (!id || !name) {
        return [];
      }

      const team = project.teams?.nodes?.find((node) => stringOrNull(node.key));
      return [
        {
          id,
          name,
          teamKey: stringOrNull(team?.key) ?? undefined,
          teamName: stringOrNull(team?.name) ?? undefined,
          mappedProjectIds: mappedProjectIdsByLinearProjectId.get(id) ?? [],
        },
      ];
    }) ?? [];

  return {
    ok: true,
    workspaceName: stringOrNull(response.data?.viewer?.organization?.name),
    userName: stringOrNull(response.data?.viewer?.name),
    projects,
    error: null,
  };
}

export const validateLinearSettings = Effect.fn("issue.linear.validateSettings")(function* (
  settings: ServerSettings,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const linearSettings = settings.issues.linear;
  if (!linearSettings.enabled) {
    return errorResult("Linear issue integration is disabled.");
  }
  if (linearSettings.apiToken.trim().length === 0) {
    return errorResult("Set a Linear API token.");
  }

  const response = yield* HttpClientRequest.post(linearGraphqlUrl(linearSettings.domain)).pipe(
    HttpClientRequest.setHeader("authorization", linearSettings.apiToken),
    HttpClientRequest.bodyJson({ query: LINEAR_PROJECTS_QUERY }),
    Effect.flatMap(httpClient.execute),
    Effect.mapError(
      (cause) =>
        new IssueProviderError({
          provider: "linear",
          operation: "validateSettings",
          detail: cause instanceof Error ? cause.message : "Failed to reach Linear.",
          cause,
        }),
    ),
  );

  if (response.status < 200 || response.status >= 300) {
    return errorResult(`Linear returned HTTP ${response.status}.`);
  }

  const json = yield* HttpClientResponse.schemaBodyJson(LinearGraphqlResponse)(response).pipe(
    Effect.mapError(
      (cause) =>
        new IssueProviderError({
          provider: "linear",
          operation: "validateSettings",
          detail: "Linear returned invalid JSON.",
          cause,
        }),
    ),
  );

  return mapLinearResponse(json, settings);
});
