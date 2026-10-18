/**
 * Where ForgeGraph lives: its web and API server, the git hosts its repositories are cloned from,
 * and how a remote URL names one of them. Plain functions, safe for clients as well as the server.
 *
 * A server at `forgegraf.com` serves git from `git.forgegraf.com` today and from the
 * `gitgw.forgegraf.com` gateway after the Cloudflare Artifacts migration, so a repository is keyed
 * on its `owner/repo` and never on which of the two git hosts a checkout happens to use.
 *
 * @module source-control-forgegraph/server/forgeGraphHosts
 */

export const DEFAULT_FORGEGRAPH_SERVER = "https://forgegraf.com";

/** The origin of a configured server, or null for anything that is not an http(s) URL. */
export function forgeGraphServerOrigin(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const url = URL.parse(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  if (url === null || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  return url.origin.toLowerCase();
}

/** The hosts a server's repositories are cloned from: its `git.` and `gitgw.` hosts. */
export function forgeGraphGitHosts(serverOrigin: string): ReadonlyArray<string> {
  const host = new URL(serverOrigin).hostname.toLowerCase();
  return [`git.${host}`, `gitgw.${host}`];
}

export function isForgeGraphGitHost(host: string, serverOrigin: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/:\d+$/u, "");
  return forgeGraphGitHosts(serverOrigin).includes(normalized);
}

export interface ForgeGraphRemote {
  /** The git host the remote names, lower case, without a port. */
  readonly gitHost: string;
  readonly owner: string;
  readonly repo: string;
  /** `owner/repo`, as ForgeGraph and T3's repository identity spell it. */
  readonly repository: string;
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/u;
const REMOTE_PATTERNS = [
  /^https?:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/iu,
  /^ssh:\/\/[^@/]+@([^/:]+)(?::\d+)?\/(.+)$/iu,
  /^[^@/:]+@([^/:]+):(.+)$/u,
];

/** The `owner/repo` of a repository path, without a `.git` suffix; null for any other shape. */
export function forgeGraphRepositoryPath(path: string): string | null {
  const [owner, repo, ...rest] = path
    .trim()
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.git$/u, "")
    .split("/");
  if (rest.length > 0 || !owner || !repo || !SEGMENT.test(owner) || !SEGMENT.test(repo))
    return null;
  return `${owner}/${repo}`;
}

/** The repository behind an https or ssh remote on one of the server's git hosts, or null. */
export function parseForgeGraphRemote(
  url: string,
  serverOrigin: string = DEFAULT_FORGEGRAPH_SERVER,
): ForgeGraphRemote | null {
  for (const pattern of REMOTE_PATTERNS) {
    const match = pattern.exec(url.trim());
    if (!match?.[1] || !match[2]) continue;
    const gitHost = match[1].toLowerCase();
    const repository = forgeGraphRepositoryPath(match[2]);
    if (!isForgeGraphGitHost(gitHost, serverOrigin) || repository === null) return null;
    const [owner = "", repo = ""] = repository.split("/");
    return { gitHost, owner, repo, repository };
  }
  return null;
}

/** ForgeGraph's own page for a pull request, which is keyed by its changeset id. */
export function forgeGraphChangesetUrl(serverOrigin: string, changesetId: string): string {
  return `${serverOrigin}/changesets/${encodeURIComponent(changesetId)}`;
}

/** ForgeGraph's page for one CI build. */
export function forgeGraphCiRunUrl(serverOrigin: string, buildId: string): string {
  return `${serverOrigin}/ci/${encodeURIComponent(buildId)}`;
}
