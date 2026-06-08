import {
  type IssueItem,
  type IssueListResult,
  IssueProviderError,
  type ProjectIssueStatus,
  type ProjectIssueStatusListResult,
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
      }
    }
  }
`;

const LINEAR_PROJECT_ISSUES_QUERY = `
  query T3CodeLinearProjectIssues($projectId: String!) {
    project(id: $projectId) {
      issues(first: 100) {
        nodes {
          id
          identifier
          title
          url
          description
          updatedAt
          state {
            id
            name
            type
          }
          assignee {
            name
          }
          labels {
            nodes {
              name
            }
          }
        }
      }
    }
  }
`;

const LINEAR_TEAMS_QUERY = `
  query T3CodeLinearTeams {
    teams(first: 100) {
      nodes {
        id
        key
        name
      }
    }
  }
`;

const LINEAR_WORKFLOW_STATES_QUERY = `
  query T3CodeLinearWorkflowStates {
    teams(first: 100) {
      nodes {
        states(first: 100) {
          nodes {
            id
            name
            type
          }
        }
      }
    }
  }
`;

const LINEAR_CREATE_ISSUE_MUTATION = `
  mutation T3CodeLinearIssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue {
        id
        identifier
        title
        url
        description
        updatedAt
        state {
          id
          name
          type
        }
        assignee {
          name
        }
        labels {
          nodes {
            name
          }
        }
      }
    }
  }
`;

const LINEAR_UPDATE_ISSUE_MUTATION = `
  mutation T3CodeLinearIssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        id
        identifier
        title
        url
        description
        updatedAt
        state {
          id
          name
          type
        }
        assignee {
          name
        }
        labels {
          nodes {
            name
          }
        }
      }
    }
  }
`;

const LinearGraphqlTeamNode = Schema.Struct({
  id: Schema.optional(Schema.Unknown),
  key: Schema.optional(Schema.Unknown),
  name: Schema.optional(Schema.Unknown),
});

const LinearGraphqlWorkflowStateNode = Schema.Struct({
  id: Schema.optional(Schema.Unknown),
  name: Schema.optional(Schema.Unknown),
  type: Schema.optional(Schema.Unknown),
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

const LinearGraphqlIssueNode = Schema.Struct({
  id: Schema.optional(Schema.Unknown),
  identifier: Schema.optional(Schema.Unknown),
  title: Schema.optional(Schema.Unknown),
  url: Schema.optional(Schema.Unknown),
  description: Schema.optional(Schema.Unknown),
  updatedAt: Schema.optional(Schema.Unknown),
  state: Schema.optional(
    Schema.Struct({
      id: Schema.optional(Schema.Unknown),
      name: Schema.optional(Schema.Unknown),
      type: Schema.optional(Schema.Unknown),
    }),
  ),
  assignee: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        name: Schema.optional(Schema.Unknown),
      }),
    ),
  ),
  labels: Schema.optional(
    Schema.Struct({
      nodes: Schema.optional(
        Schema.Array(
          Schema.Struct({
            name: Schema.optional(Schema.Unknown),
          }),
        ),
      ),
    }),
  ),
});

const LinearProjectIssuesGraphqlResponse = Schema.Struct({
  data: Schema.optional(
    Schema.Struct({
      project: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            issues: Schema.optional(
              Schema.Struct({
                nodes: Schema.optional(Schema.Array(LinearGraphqlIssueNode)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
  errors: Schema.optional(
    Schema.Array(Schema.Struct({ message: Schema.optional(Schema.Unknown) })),
  ),
});
type LinearProjectIssuesGraphqlResponse = typeof LinearProjectIssuesGraphqlResponse.Type;

const LinearProjectTeamGraphqlResponse = Schema.Struct({
  data: Schema.optional(
    Schema.Struct({
      teams: Schema.optional(
        Schema.Struct({
          nodes: Schema.optional(Schema.Array(LinearGraphqlTeamNode)),
        }),
      ),
    }),
  ),
  errors: Schema.optional(
    Schema.Array(Schema.Struct({ message: Schema.optional(Schema.Unknown) })),
  ),
});
type LinearProjectTeamGraphqlResponse = typeof LinearProjectTeamGraphqlResponse.Type;

const LinearWorkflowStatesGraphqlResponse = Schema.Struct({
  data: Schema.optional(
    Schema.Struct({
      teams: Schema.optional(
        Schema.Struct({
          nodes: Schema.optional(
            Schema.Array(
              Schema.Struct({
                states: Schema.optional(
                  Schema.Struct({
                    nodes: Schema.optional(Schema.Array(LinearGraphqlWorkflowStateNode)),
                  }),
                ),
              }),
            ),
          ),
        }),
      ),
    }),
  ),
  errors: Schema.optional(
    Schema.Array(Schema.Struct({ message: Schema.optional(Schema.Unknown) })),
  ),
});
type LinearWorkflowStatesGraphqlResponse = typeof LinearWorkflowStatesGraphqlResponse.Type;

const LinearIssueMutationGraphqlResponse = Schema.Struct({
  data: Schema.optional(
    Schema.Struct({
      issueCreate: Schema.optional(
        Schema.Struct({
          success: Schema.optional(Schema.Unknown),
          issue: Schema.optional(Schema.NullOr(LinearGraphqlIssueNode)),
        }),
      ),
      issueUpdate: Schema.optional(
        Schema.Struct({
          success: Schema.optional(Schema.Unknown),
          issue: Schema.optional(Schema.NullOr(LinearGraphqlIssueNode)),
        }),
      ),
    }),
  ),
  errors: Schema.optional(
    Schema.Array(Schema.Struct({ message: Schema.optional(Schema.Unknown) })),
  ),
});
type LinearIssueMutationGraphqlResponse = typeof LinearIssueMutationGraphqlResponse.Type;

export function normalizeLinearDomain(domain: string): string {
  const trimmed = domain.trim() || "linear.app";
  return trimmed
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/u, "")
    .replace(/^api\./i, "")
    .trim();
}

export function linearGraphqlUrl(domain: string): string {
  const normalized = normalizeLinearDomain(domain);
  const url = new URL(normalized.match(/^https?:\/\//i) ? normalized : `https://${normalized}`);
  if (url.hostname === "linear.app") {
    url.hostname = "api.linear.app";
  }
  if (url.pathname === "/" || url.pathname.length === 0) {
    url.pathname = "/graphql";
  }
  return url.toString();
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

function normalizeLinearIssueState(value: unknown): IssueItem["state"] {
  const normalized = stringOrNull(value)?.toLowerCase();
  switch (normalized) {
    case "triage":
    case "backlog":
    case "unstarted":
      return "open";
    case "started":
    case "in progress":
      return "in_progress";
    case "completed":
    case "done":
      return "done";
    case "canceled":
    case "cancelled":
      return "canceled";
    default:
      return "unknown";
  }
}

function slugifyIssueSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildSuggestedBranchName(identifier: string, title: string): string {
  const slug = slugifyIssueSegment(title);
  const normalizedIdentifier = identifier.toLowerCase();
  return slug.length > 0
    ? `linear/${normalizedIdentifier}-${slug}`
    : `linear/${normalizedIdentifier}`;
}

function optionalStringProperty<T extends string>(
  key: T,
  value: string | null,
): Partial<Record<T, string | null>> {
  return value === null ? {} : ({ [key]: value } as Partial<Record<T, string | null>>);
}

function mapLinearIssueNode(issue: typeof LinearGraphqlIssueNode.Type): IssueItem | null {
  const id = stringOrNull(issue.id);
  const key = stringOrNull(issue.identifier);
  const title = stringOrNull(issue.title);
  const url = stringOrNull(issue.url);
  if (!id || !key || !title || !url) {
    return null;
  }

  const descriptionMarkdown = stringOrNull(issue.description);
  const statusId = stringOrNull(issue.state?.id);
  const statusName = stringOrNull(issue.state?.name);
  const updatedAt = stringOrNull(issue.updatedAt);

  return {
    provider: "linear",
    id,
    key,
    title,
    url,
    state: normalizeLinearIssueState(issue.state?.type ?? issue.state?.name),
    ...(statusId ? { statusId } : {}),
    ...(statusName ? { statusName } : {}),
    assigneeName: stringOrNull(issue.assignee?.name),
    labels:
      issue.labels?.nodes?.flatMap((label) => {
        const name = stringOrNull(label.name);
        return name ? [name] : [];
      }) ?? [],
    comments: [],
    ...optionalStringProperty("descriptionMarkdown", descriptionMarkdown),
    suggestedBranchName: buildSuggestedBranchName(key, title),
    ...optionalStringProperty("updatedAt", updatedAt),
  } satisfies IssueItem;
}

function issueProviderError(input: {
  operation: string;
  detail: string;
  cause?: unknown;
}): IssueProviderError {
  return new IssueProviderError({
    provider: "linear",
    operation: input.operation,
    detail: input.detail,
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}

function assertLinearEnabled(settings: ServerSettings, operation: string) {
  const linearSettings = settings.issues.linear;
  if (!linearSettings.enabled) {
    throw issueProviderError({
      operation,
      detail: "Linear issue integration is disabled.",
    });
  }
  if (linearSettings.apiToken.trim().length === 0) {
    throw issueProviderError({
      operation,
      detail: "Set a Linear API token.",
    });
  }
  return linearSettings;
}

function getMappedProject(settings: ServerSettings, projectId: ProjectId, operation: string) {
  const linearSettings = assertLinearEnabled(settings, operation);
  const mapping = linearSettings.projectMappings[projectId];
  if (!mapping) {
    throw issueProviderError({
      operation,
      detail: `Project ${projectId} is not mapped to a Linear project.`,
    });
  }
  return { linearSettings, mapping };
}

function mapLinearProjectIssuesResponse(
  response: LinearProjectIssuesGraphqlResponse,
  options?: {
    readonly query?: string;
    readonly limit?: number;
  },
): IssueListResult {
  const firstError = response.errors?.find((error) => stringOrNull(error.message))?.message;
  if (firstError) {
    throw new IssueProviderError({
      provider: "linear",
      operation: "listProjectIssues",
      detail: String(firstError),
    });
  }

  const normalizedQuery = options?.query?.trim().toLowerCase() ?? "";
  const limit = options?.limit ?? 50;
  const issues =
    response.data?.project?.issues?.nodes?.flatMap((issue) => {
      const mappedIssue = mapLinearIssueNode(issue);
      if (!mappedIssue) {
        return [];
      }

      if (normalizedQuery.length > 0) {
        const haystack = [mappedIssue.key, mappedIssue.title, mappedIssue.descriptionMarkdown ?? ""]
          .join("\n")
          .toLowerCase();
        if (!haystack.includes(normalizedQuery)) {
          return [];
        }
      }

      return [mappedIssue];
    }) ?? [];

  return {
    issues: issues.slice(0, Math.max(1, limit)),
  };
}

function firstGraphqlError(response: {
  readonly errors?: readonly { readonly message?: unknown }[] | undefined;
}): string | null {
  return stringOrNull(response.errors?.find((error) => stringOrNull(error.message))?.message);
}

function executeLinearGraphql<S extends Schema.Top>(input: {
  readonly settings: ServerSettings;
  readonly operation: string;
  readonly query: string;
  readonly variables?: Record<string, unknown>;
  readonly schema: S;
}): Effect.Effect<S["Type"], IssueProviderError, HttpClient.HttpClient | S["DecodingServices"]> {
  return Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const linearSettings = assertLinearEnabled(input.settings, input.operation);
    const response = yield* HttpClientRequest.post(linearGraphqlUrl(linearSettings.domain)).pipe(
      HttpClientRequest.setHeader("authorization", linearSettings.apiToken),
      HttpClientRequest.bodyJson({
        query: input.query,
        ...(input.variables ? { variables: input.variables } : {}),
      }),
      Effect.flatMap(httpClient.execute),
      Effect.mapError((cause) =>
        issueProviderError({
          operation: input.operation,
          detail: cause instanceof Error ? cause.message : "Failed to reach Linear.",
          cause,
        }),
      ),
    );

    if (response.status < 200 || response.status >= 300) {
      throw issueProviderError({
        operation: input.operation,
        detail: `Linear returned HTTP ${response.status}.`,
      });
    }

    return yield* HttpClientResponse.schemaBodyJson(input.schema)(response).pipe(
      Effect.mapError((cause) =>
        issueProviderError({
          operation: input.operation,
          detail: "Linear returned invalid JSON.",
          cause,
        }),
      ),
    );
  });
}

function assertNoGraphqlError(
  response: { readonly errors?: readonly { readonly message?: unknown }[] | undefined },
  operation: string,
) {
  const firstError = firstGraphqlError(response);
  if (firstError) {
    throw issueProviderError({
      operation,
      detail: firstError,
    });
  }
}

function selectLinearTeamId(
  response: LinearProjectTeamGraphqlResponse,
  teamKey: string,
  operation: string,
): string {
  assertNoGraphqlError(response, operation);
  const teams = response.data?.teams?.nodes ?? [];
  const normalizedTeamKey = teamKey.trim().toLowerCase();
  const selectedTeam =
    (normalizedTeamKey.length > 0
      ? teams.find((team) => stringOrNull(team.key)?.toLowerCase() === normalizedTeamKey)
      : null) ??
    teams.find((team) => stringOrNull(team.id)) ??
    null;
  const teamId = stringOrNull(selectedTeam?.id);
  if (!teamId) {
    throw issueProviderError({
      operation,
      detail:
        normalizedTeamKey.length > 0
          ? `Linear project has no team with key ${teamKey}.`
          : "Linear project has no team available for issue creation.",
    });
  }
  return teamId;
}

function selectWorkflowStateId(
  response: LinearWorkflowStatesGraphqlResponse,
  status: { readonly id?: string; readonly name?: string },
  operation: string,
): string {
  assertNoGraphqlError(response, operation);
  const states = response.data?.teams?.nodes?.flatMap((team) => team.states?.nodes ?? []) ?? [];
  const normalizedStatusId = status.id?.trim().toLowerCase() ?? "";
  const normalizedStatusName = status.name?.trim().toLowerCase() ?? "";
  const selectedState =
    (normalizedStatusId.length > 0
      ? states.find((state) => stringOrNull(state.id)?.toLowerCase() === normalizedStatusId)
      : null) ??
    (normalizedStatusName.length > 0
      ? states.find((state) => stringOrNull(state.name)?.toLowerCase() === normalizedStatusName)
      : null);
  const statusId = stringOrNull(selectedState?.id);
  if (!statusId) {
    throw issueProviderError({
      operation,
      detail:
        normalizedStatusName.length > 0
          ? `Linear project has no workflow state named ${status.name}.`
          : `Linear project has no workflow state with id ${status.id}.`,
    });
  }
  return statusId;
}

function mapLinearWorkflowStatesResponse(
  response: LinearWorkflowStatesGraphqlResponse,
  operation: string,
): ProjectIssueStatusListResult {
  assertNoGraphqlError(response, operation);
  const statusesById = new Map<string, ProjectIssueStatus>();
  const states = response.data?.teams?.nodes?.flatMap((team) => team.states?.nodes ?? []) ?? [];
  for (const state of states) {
    const id = stringOrNull(state.id);
    const name = stringOrNull(state.name);
    if (!id || !name || statusesById.has(id)) {
      continue;
    }
    statusesById.set(id, {
      id,
      name,
      state: normalizeLinearIssueState(state.type ?? state.name),
    });
  }
  return { statuses: [...statusesById.values()] };
}

function mapMutationIssue(
  response: LinearIssueMutationGraphqlResponse,
  operation: string,
  field: "issueCreate" | "issueUpdate",
): IssueItem {
  assertNoGraphqlError(response, operation);
  const mutation = response.data?.[field];
  if (mutation?.success === false) {
    throw issueProviderError({
      operation,
      detail: "Linear did not apply the issue mutation.",
    });
  }
  const issue = mutation?.issue ? mapLinearIssueNode(mutation.issue) : null;
  if (!issue) {
    throw issueProviderError({
      operation,
      detail: "Linear returned no issue for the mutation.",
    });
  }
  return issue;
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

export const listMappedProjectIssues = Effect.fn("issue.linear.listMappedProjectIssues")(function* (
  settings: ServerSettings,
  input: {
    readonly projectId: ProjectId;
    readonly query?: string;
    readonly limit?: number;
  },
) {
  const { mapping } = getMappedProject(settings, input.projectId, "listProjectIssues");
  const json = yield* executeLinearGraphql({
    settings,
    operation: "listProjectIssues",
    query: LINEAR_PROJECT_ISSUES_QUERY,
    variables: {
      projectId: mapping.linearProjectId,
    },
    schema: LinearProjectIssuesGraphqlResponse,
  });

  const options: { query?: string; limit?: number } = {};
  if (input.query !== undefined) options.query = input.query;
  if (input.limit !== undefined) options.limit = input.limit;
  return mapLinearProjectIssuesResponse(json, options);
});

export const listMappedProjectIssueStatuses = Effect.fn(
  "issue.linear.listMappedProjectIssueStatuses",
)(function* (
  settings: ServerSettings,
  input: {
    readonly projectId: ProjectId;
  },
) {
  getMappedProject(settings, input.projectId, "listProjectIssueStatuses");
  const json = yield* executeLinearGraphql({
    settings,
    operation: "listProjectIssueStatuses",
    query: LINEAR_WORKFLOW_STATES_QUERY,
    schema: LinearWorkflowStatesGraphqlResponse,
  });
  return mapLinearWorkflowStatesResponse(json, "listProjectIssueStatuses");
});

export const createMappedProjectIssue = Effect.fn("issue.linear.createMappedProjectIssue")(
  function* (
    settings: ServerSettings,
    input: {
      readonly projectId: ProjectId;
      readonly title: string;
      readonly descriptionMarkdown?: string;
      readonly statusId?: string;
      readonly statusName?: string;
    },
  ) {
    const { linearSettings, mapping } = getMappedProject(
      settings,
      input.projectId,
      "createProjectIssue",
    );
    const teamResponse = yield* executeLinearGraphql({
      settings,
      operation: "createProjectIssue",
      query: LINEAR_TEAMS_QUERY,
      schema: LinearProjectTeamGraphqlResponse,
    });
    const teamId = selectLinearTeamId(
      teamResponse,
      mapping.teamKey || linearSettings.defaultTeamKey,
      "createProjectIssue",
    );

    const createInput: Record<string, unknown> = {
      teamId,
      projectId: mapping.linearProjectId,
      title: input.title,
    };
    if (input.descriptionMarkdown !== undefined && input.descriptionMarkdown.trim().length > 0) {
      createInput.description = input.descriptionMarkdown;
    }

    const statusId = input.statusId?.trim();
    const statusName = input.statusName?.trim();
    if ((statusId?.length ?? 0) > 0 || (statusName?.length ?? 0) > 0) {
      const workflowResponse = yield* executeLinearGraphql({
        settings,
        operation: "createProjectIssue",
        query: LINEAR_WORKFLOW_STATES_QUERY,
        schema: LinearWorkflowStatesGraphqlResponse,
      });
      createInput.stateId = selectWorkflowStateId(
        workflowResponse,
        {
          ...(statusId ? { id: statusId } : {}),
          ...(statusName ? { name: statusName } : {}),
        },
        "createProjectIssue",
      );
    }

    const mutationResponse = yield* executeLinearGraphql({
      settings,
      operation: "createProjectIssue",
      query: LINEAR_CREATE_ISSUE_MUTATION,
      variables: {
        input: createInput,
      },
      schema: LinearIssueMutationGraphqlResponse,
    });

    return {
      issue: mapMutationIssue(mutationResponse, "createProjectIssue", "issueCreate"),
    };
  },
);

export const updateMappedProjectIssueStatus = Effect.fn(
  "issue.linear.updateMappedProjectIssueStatus",
)(function* (
  settings: ServerSettings,
  input: {
    readonly projectId: ProjectId;
    readonly issueId: string;
    readonly statusId?: string;
    readonly statusName?: string;
  },
) {
  getMappedProject(settings, input.projectId, "updateProjectIssueStatus");
  const statusId = input.statusId?.trim();
  const statusName = input.statusName?.trim();
  if ((statusId?.length ?? 0) === 0 && (statusName?.length ?? 0) === 0) {
    throw issueProviderError({
      operation: "updateProjectIssueStatus",
      detail: "Select a workflow status.",
    });
  }
  const workflowResponse = yield* executeLinearGraphql({
    settings,
    operation: "updateProjectIssueStatus",
    query: LINEAR_WORKFLOW_STATES_QUERY,
    schema: LinearWorkflowStatesGraphqlResponse,
  });
  const stateId = selectWorkflowStateId(
    workflowResponse,
    {
      ...(statusId ? { id: statusId } : {}),
      ...(statusName ? { name: statusName } : {}),
    },
    "updateProjectIssueStatus",
  );

  const mutationResponse = yield* executeLinearGraphql({
    settings,
    operation: "updateProjectIssueStatus",
    query: LINEAR_UPDATE_ISSUE_MUTATION,
    variables: {
      id: input.issueId,
      input: {
        stateId,
      },
    },
    schema: LinearIssueMutationGraphqlResponse,
  });

  return {
    issue: mapMutationIssue(mutationResponse, "updateProjectIssueStatus", "issueUpdate"),
  };
});
