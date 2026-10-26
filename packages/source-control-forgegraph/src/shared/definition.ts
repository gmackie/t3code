import {
  makeProviderSettingsSchema,
  secretSetting,
  SourceControlProviderKind,
  TrimmedString,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  defineSourceControl,
  isChangeRequestInProjectRepository,
  isChangeRequestOnProjectHost,
  parseChangeRequestPath,
  projectChangeRequestHost,
} from "@t3tools/source-control-core/shared/definition";

import {
  DEFAULT_FORGEGRAPH_SERVER,
  forgeGraphServerOrigin,
  isForgeGraphGitHost,
} from "./forgeGraphHosts.ts";
import { icon } from "./icon.ts";

const KIND = SourceControlProviderKind.make("forgegraph");

/** The server ForgeGraph is read from, and the token it is read with (saved by signing in). */
export const settings = makeProviderSettingsSchema({
  serverUrl: TrimmedString.pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
    Schema.annotateKey({
      title: "Server",
      description:
        "The ForgeGraph server to use. Empty uses FG_SERVER, then the forge CLI's server, then forgegraf.com.",
      providerSettingsForm: { placeholder: DEFAULT_FORGEGRAPH_SERVER },
    }),
  ),
  token: TrimmedString.pipe(
    secretSetting,
    Schema.withDecodingDefault(Effect.succeed("")),
    Schema.annotateKey({
      title: "Token",
      description:
        "A ForgeGraph API token (fg_…), used before FG_API_TOKEN and the forge CLI's login. Signing in saves one here.",
      providerSettingsForm: { control: "password" },
    }),
  ),
});
export type ForgeGraphSettings = typeof settings.Type;

/** Branch names that are safe to put in a shell command without quoting. */
const SHELL_SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/u;

/** The legacy Forgejo-mirror route, the only change request URL that carries a number. */
const CHANGE_REQUEST_PATH = /^\/([^/]+\/[^/]+)\/pulls\/(\d+)(?:\/|$)/u;

// Forgejo claims `/pulls/` on any host, so ForgeGraph claims it first, on its own git hosts only.
function parseChangeRequestUrl(url: URL) {
  return isForgeGraphGitHost(url.hostname, DEFAULT_FORGEGRAPH_SERVER)
    ? parseChangeRequestPath(url, CHANGE_REQUEST_PATH)
    : null;
}

function isForgeGraphPullUrl(value: string): boolean {
  try {
    return parseChangeRequestUrl(new URL(value)) !== null;
  } catch {
    return false;
  }
}

export const definition = defineSourceControl({
  kind: KIND,
  label: "ForgeGraph",
  pickerLabel: "ForgeGraph",
  icon,
  searchKeywords: ["forge", "fg"],
  changeRequest: {
    shortLabel: "PR",
    shortLabelWithArticle: "a PR",
    singular: "pull request",
    plural: "pull requests",
  },
  repositoryPathHint: "owner/repo",
  publicHost: null,
  publishDescription: "forgegraf.com",
  publishHost: (signedInHost) =>
    forgeGraphServerOrigin(signedInHost)?.replace(/^https?:\/\//u, "") ?? "forgegraf.com",
  // Repository creation goes through ForgeGraph apps, which T3 does not create.
  newRepositoryOwner: () => null,
  defaultCloneTransport: "https",
  // ForgeGraph's page is keyed by changeset id, which a number does not carry; clients open the
  // URL the server handed back instead.
  changeRequestUrl: () => null,
  parseChangeRequestUrl,
  changeRequestUrlFromReferenceAutolink: () => null,
  changeRequestActions: new Set([
    "merge",
    "enable-auto-merge",
    "disable-auto-merge",
    "close",
  ] as const),
  checkoutCommand: ({ headBranch }) =>
    SHELL_SAFE_BRANCH.test(headBranch)
      ? `git fetch origin ${headBranch} && git switch ${headBranch}`
      : null,
  authorProfileUrl: () => null,
  reviewSummaryRequired: () => false,
  checkoutCommandArgument: () => null,
  isChangeRequestReference: isForgeGraphPullUrl,
  checkoutChangeRequestHost: () => null,
  // A self-hosted ForgeGraph's hosts are only known from Settings, so its driver claims them.
  recognizeRemote: ({ hostname }) =>
    isForgeGraphGitHost(hostname, DEFAULT_FORGEGRAPH_SERVER)
      ? { kind: KIND, name: "ForgeGraph", baseUrl: DEFAULT_FORGEGRAPH_SERVER }
      : null,
  isChangeRequestInRepository: (identity, link) =>
    isChangeRequestInProjectRepository(projectChangeRequestHost(identity, KIND), identity, link),
  canReadChangeRequestOnHost: (identity, link) =>
    isChangeRequestOnProjectHost(projectChangeRequestHost(identity, KIND), identity, link),
  settings,
});
