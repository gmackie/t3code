/**
 * ForgeGraph's client definition. Browser- and React Native-safe.
 *
 * @module source-control-forgegraph/client/definition
 */
import {
  makeProviderSettingsSchema,
  secretSetting,
  SourceControlProviderKind,
  TrimmedString,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  defineSourceControlClient,
  isChangeRequestInProjectRepository,
  isChangeRequestOnProjectHost,
  isChangeRequestPath,
} from "@t3tools/source-control-core/client/definition";

import {
  DEFAULT_FORGEGRAPH_SERVER,
  forgeGraphServerOrigin,
  isForgeGraphGitHost,
} from "../server/forgeGraphHosts.ts";

const KIND = SourceControlProviderKind.make("forgegraph");

/**
 * The server ForgeGraph is read from, and the token it is read with. The token is normally saved
 * by signing in from Settings; one pasted here works the same way.
 */
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

/** A legacy Forgejo-mirror page on one of ForgeGraph's own git hosts. */
const isForgeGraphPullUrl = (url: string) => {
  try {
    return (
      isForgeGraphGitHost(new URL(url).hostname, DEFAULT_FORGEGRAPH_SERVER) &&
      isChangeRequestPath(url, "/pulls/")
    );
  } catch {
    return false;
  }
};

export const definition = defineSourceControlClient({
  kind: KIND,
  label: "ForgeGraph",
  pickerLabel: "ForgeGraph",
  icon: "forgegraph",
  changeRequest: { shortLabel: "PR", singular: "pull request" },
  repositoryPathHint: "owner/repo",
  publicHost: null,
  publishDescription: "forgegraf.com",
  publishHost: (signedInHost) =>
    forgeGraphServerOrigin(signedInHost)?.replace(/^https?:\/\//u, "") ?? "forgegraf.com",
  // Repository creation goes through ForgeGraph apps, which T3 does not create.
  newRepositoryOwner: () => null,
  defaultCloneTransport: "https",
  // ForgeGraph's page for a pull request is keyed by its changeset id, which a number does not
  // carry; clients open the URL the server handed back instead.
  changeRequestUrl: () => null,
  changeRequestActions: new Set(["merge", "enable-auto-merge", "close"] as const),
  checkoutCommand: ({ headBranch }) =>
    SHELL_SAFE_BRANCH.test(headBranch)
      ? `git fetch origin ${headBranch} && git switch ${headBranch}`
      : null,
  authorProfileUrl: () => null,
  referenceAutolinkRepositoryUrl: () => null,
  reviewSummaryRequired: () => false,
  checkoutCommandArgument: () => null,
  isChangeRequestReference: isForgeGraphPullUrl,
  changeRequestUrlHost: (url) => url.hostname,
  checkoutChangeRequestHost: () => null,
  isChangeRequestInRepository: (identity, link) =>
    isChangeRequestInProjectRepository(KIND, identity, link),
  canReadChangeRequestOnHost: (identity, link) =>
    isChangeRequestOnProjectHost(KIND, identity, link),
  isChangeRequestUrl: isForgeGraphPullUrl,
  settings,
});
