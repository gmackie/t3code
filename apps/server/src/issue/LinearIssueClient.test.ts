import { assert, describe, it, vi } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import {
  createMappedProjectIssue,
  linearGraphqlUrl,
  listMappedProjectIssues,
  listMappedProjectIssueStatuses,
  updateMappedProjectIssueStatus,
  validateLinearSettings,
} from "./LinearIssueClient.ts";

describe("LinearIssueClient", () => {
  it("uses Linear's API host for the default Linear domain", () => {
    assert.equal(linearGraphqlUrl("linear.app"), "https://api.linear.app/graphql");
  });

  it("uses custom Linear-compatible domains directly", () => {
    assert.equal(linearGraphqlUrl("tasks.gmac.io"), "https://tasks.gmac.io/graphql");
  });

  it("preserves full custom Linear-compatible GraphQL URLs", () => {
    assert.equal(
      linearGraphqlUrl("https://tasks.gmac.io/graphql"),
      "https://tasks.gmac.io/graphql",
    );
  });

  it.effect("validates Linear-compatible clones without requiring project teams", () => {
    const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) => {
      const rawBody = (request.body as { readonly body?: Uint8Array }).body;
      assert.ok(rawBody);
      const body = JSON.parse(new TextDecoder().decode(rawBody)) as { readonly query?: string };
      if (body.query?.includes("teams")) {
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              errors: [
                {
                  message: "Unexpected error.",
                  path: ["projects", "nodes", 0, "teams"],
                  extensions: { code: "INTERNAL_SERVER_ERROR" },
                },
              ],
            }),
          ),
        );
      }

      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            data: {
              viewer: { name: "Mackie", organization: { name: "GMACKO" } },
              projects: {
                nodes: [{ id: "linear-project-1", name: "T3 Code" }],
              },
            },
          }),
        ),
      );
    });

    return Effect.gen(function* () {
      const result = yield* validateLinearSettings({
        ...DEFAULT_SERVER_SETTINGS,
        issues: {
          ...DEFAULT_SERVER_SETTINGS.issues,
          linear: {
            ...DEFAULT_SERVER_SETTINGS.issues.linear,
            enabled: true,
            apiToken: "token",
            domain: "tasks.gmac.io",
          },
        },
      });

      assert.deepStrictEqual(result, {
        ok: true,
        workspaceName: "GMACKO",
        userName: "Mackie",
        error: null,
        projects: [
          {
            id: "linear-project-1",
            name: "T3 Code",
            teamKey: undefined,
            teamName: undefined,
            mappedProjectIds: [],
          },
        ],
      });
    }).pipe(
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => execute(request)),
        ),
      ),
    );
  });

  it.effect("lists issues for a mapped Linear project", () => {
    const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            data: {
              project: {
                issues: {
                  nodes: [
                    {
                      id: "issue-1",
                      identifier: "ENG-123",
                      title: "Fix startup regression",
                      url: "https://linear.app/acme/issue/ENG-123/fix-startup-regression",
                      description: "Users hit a blank screen after launch.",
                      updatedAt: "2026-06-04T18:00:00.000Z",
                      state: { id: "state-started", name: "In Progress", type: "started" },
                      assignee: { name: "Mackie" },
                      labels: { nodes: [{ name: "bug" }, { name: "customer" }] },
                    },
                    {
                      id: "issue-2",
                      identifier: "ENG-124",
                      title: "Polish settings header",
                      url: "https://linear.app/acme/issue/ENG-124/polish-settings-header",
                      description: null,
                      updatedAt: "2026-06-04T17:00:00.000Z",
                      state: { id: "state-backlog", name: "Backlog", type: "unstarted" },
                      assignee: null,
                      labels: { nodes: [] },
                    },
                  ],
                },
              },
            },
          }),
        ),
      ),
    );

    return Effect.gen(function* () {
      const result = yield* listMappedProjectIssues(
        {
          ...DEFAULT_SERVER_SETTINGS,
          issues: {
            ...DEFAULT_SERVER_SETTINGS.issues,
            linear: {
              ...DEFAULT_SERVER_SETTINGS.issues.linear,
              enabled: true,
              apiToken: "token",
              domain: "linear.app",
              projectMappings: {
                [ProjectId.make("project-1")]: {
                  linearProjectId: "linear-project-1",
                  linearProjectName: "T3 Code",
                  teamKey: "ENG",
                },
              },
            },
          },
        },
        {
          projectId: ProjectId.make("project-1"),
          query: "startup",
        },
      );

      assert.deepStrictEqual(result, {
        issues: [
          {
            provider: "linear",
            id: "issue-1",
            key: "ENG-123",
            title: "Fix startup regression",
            url: "https://linear.app/acme/issue/ENG-123/fix-startup-regression",
            state: "in_progress",
            statusId: "state-started",
            statusName: "In Progress",
            assigneeName: "Mackie",
            labels: ["bug", "customer"],
            comments: [],
            descriptionMarkdown: "Users hit a blank screen after launch.",
            suggestedBranchName: "linear/eng-123-fix-startup-regression",
            updatedAt: "2026-06-04T18:00:00.000Z",
          },
        ],
      });
    }).pipe(
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => execute(request)),
        ),
      ),
    );
  });

  it.effect("creates an issue in a mapped Linear project", () => {
    const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) => {
      const rawBody = (request.body as { readonly body?: Uint8Array }).body;
      assert.ok(rawBody);
      const body = JSON.parse(new TextDecoder().decode(rawBody)) as {
        readonly query?: string;
        readonly variables?: Record<string, unknown>;
      };

      if (body.query?.includes("T3CodeLinearTeams")) {
        assert.equal(body.variables, undefined);
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              data: {
                teams: {
                  nodes: [{ id: "team-1", key: "ENG", name: "Engineering" }],
                },
              },
            }),
          ),
        );
      }

      assert.ok(body.query?.includes("issueCreate"));
      assert.deepStrictEqual(body.variables, {
        input: {
          teamId: "team-1",
          projectId: "linear-project-1",
          title: "Fix project issue viewer",
          description: "Build list and kanban views.",
        },
      });
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            data: {
              issueCreate: {
                success: true,
                issue: {
                  id: "issue-1",
                  identifier: "ENG-125",
                  title: "Fix project issue viewer",
                  url: "https://linear.app/acme/issue/ENG-125/fix-project-issue-viewer",
                  description: "Build list and kanban views.",
                  updatedAt: "2026-06-05T01:00:00.000Z",
                  state: { id: "state-backlog", name: "Backlog", type: "unstarted" },
                  assignee: null,
                  labels: { nodes: [] },
                },
              },
            },
          }),
        ),
      );
    });

    return Effect.gen(function* () {
      const result = yield* createMappedProjectIssue(
        {
          ...DEFAULT_SERVER_SETTINGS,
          issues: {
            ...DEFAULT_SERVER_SETTINGS.issues,
            linear: {
              ...DEFAULT_SERVER_SETTINGS.issues.linear,
              enabled: true,
              apiToken: "token",
              domain: "linear.app",
              projectMappings: {
                [ProjectId.make("project-1")]: {
                  linearProjectId: "linear-project-1",
                  linearProjectName: "T3 Code",
                  teamKey: "ENG",
                },
              },
            },
          },
        },
        {
          projectId: ProjectId.make("project-1"),
          title: "Fix project issue viewer",
          descriptionMarkdown: "Build list and kanban views.",
        },
      );

      assert.equal(result.issue.key, "ENG-125");
      assert.equal(result.issue.statusId, "state-backlog");
      assert.equal(result.issue.title, "Fix project issue viewer");
    }).pipe(
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => execute(request)),
        ),
      ),
    );
  });

  it.effect("updates a mapped Linear issue status by workflow state name", () => {
    const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) => {
      const rawBody = (request.body as { readonly body?: Uint8Array }).body;
      assert.ok(rawBody);
      const body = JSON.parse(new TextDecoder().decode(rawBody)) as {
        readonly query?: string;
        readonly variables?: Record<string, unknown>;
      };

      if (body.query?.includes("T3CodeLinearWorkflowStates")) {
        assert.equal(body.variables, undefined);
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              data: {
                teams: {
                  nodes: [
                    {
                      states: {
                        nodes: [
                          { id: "state-backlog", name: "Backlog", type: "unstarted" },
                          { id: "state-started", name: "In Progress", type: "started" },
                        ],
                      },
                    },
                  ],
                },
              },
            }),
          ),
        );
      }

      assert.ok(body.query?.includes("issueUpdate"));
      assert.deepStrictEqual(body.variables, {
        id: "issue-1",
        input: {
          stateId: "state-started",
        },
      });
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            data: {
              issueUpdate: {
                success: true,
                issue: {
                  id: "issue-1",
                  identifier: "ENG-123",
                  title: "Fix startup regression",
                  url: "https://linear.app/acme/issue/ENG-123/fix-startup-regression",
                  description: "Users hit a blank screen after launch.",
                  updatedAt: "2026-06-05T02:00:00.000Z",
                  state: { id: "state-started", name: "In Progress", type: "started" },
                  assignee: { name: "Mackie" },
                  labels: { nodes: [{ name: "bug" }] },
                },
              },
            },
          }),
        ),
      );
    });

    return Effect.gen(function* () {
      const result = yield* updateMappedProjectIssueStatus(
        {
          ...DEFAULT_SERVER_SETTINGS,
          issues: {
            ...DEFAULT_SERVER_SETTINGS.issues,
            linear: {
              ...DEFAULT_SERVER_SETTINGS.issues.linear,
              enabled: true,
              apiToken: "token",
              domain: "linear.app",
              projectMappings: {
                [ProjectId.make("project-1")]: {
                  linearProjectId: "linear-project-1",
                  linearProjectName: "T3 Code",
                  teamKey: "ENG",
                },
              },
            },
          },
        },
        {
          projectId: ProjectId.make("project-1"),
          issueId: "issue-1",
          statusName: "In Progress",
        },
      );

      assert.equal(result.issue.id, "issue-1");
      assert.equal(result.issue.statusId, "state-started");
      assert.equal(result.issue.state, "in_progress");
    }).pipe(
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => execute(request)),
        ),
      ),
    );
  });

  it.effect("lists all workflow states for a mapped Linear project", () => {
    const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) => {
      const rawBody = (request.body as { readonly body?: Uint8Array }).body;
      assert.ok(rawBody);
      const body = JSON.parse(new TextDecoder().decode(rawBody)) as {
        readonly query?: string;
        readonly variables?: Record<string, unknown>;
      };

      assert.ok(body.query?.includes("T3CodeLinearWorkflowStates"));
      assert.equal(body.variables, undefined);

      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            data: {
              teams: {
                nodes: [
                  {
                    states: {
                      nodes: [
                        { id: "state-backlog", name: "Backlog", type: "unstarted" },
                        { id: "state-review", name: "In Review", type: "started" },
                      ],
                    },
                  },
                  {
                    states: {
                      nodes: [
                        { id: "state-review", name: "In Review", type: "started" },
                        { id: "state-done", name: "Done", type: "completed" },
                      ],
                    },
                  },
                ],
              },
            },
          }),
        ),
      );
    });

    return Effect.gen(function* () {
      const result = yield* listMappedProjectIssueStatuses(
        {
          ...DEFAULT_SERVER_SETTINGS,
          issues: {
            ...DEFAULT_SERVER_SETTINGS.issues,
            linear: {
              ...DEFAULT_SERVER_SETTINGS.issues.linear,
              enabled: true,
              apiToken: "token",
              domain: "tasks.gmac.io",
              projectMappings: {
                [ProjectId.make("project-1")]: {
                  linearProjectId: "linear-project-1",
                  linearProjectName: "T3 Code",
                  teamKey: "ENG",
                },
              },
            },
          },
        },
        {
          projectId: ProjectId.make("project-1"),
        },
      );

      assert.deepStrictEqual(result, {
        statuses: [
          { id: "state-backlog", name: "Backlog", state: "open" },
          { id: "state-review", name: "In Review", state: "in_progress" },
          { id: "state-done", name: "Done", state: "done" },
        ],
      });
    }).pipe(
      Effect.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => execute(request)),
        ),
      ),
    );
  });
});
