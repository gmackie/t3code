export interface UpstreamChange {
  readonly title: string;
  readonly author: string | null;
  readonly pullRequestUrl: string | null;
  readonly pullRequestNumber: number | null;
}

const GENERATED_NOTE_LINE =
  /^\*\s+(.+?)\s+by\s+@([\w.-]+(?:\[bot\])?)\s+in\s+(https:\/\/github\.com\/[^\s]+\/pull\/(\d+))\s*$/;

/**
 * Bullet lines from GitHub's generated "What's Changed" release notes, which
 * upstream nightlies use (`* fix(web): … by @user in https://…/pull/123`).
 * Bullets in another shape keep their text.
 */
export function parseUpstreamChanges(bodyMarkdown: string): UpstreamChange[] {
  const changes: UpstreamChange[] = [];
  for (const rawLine of bodyMarkdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("* ") && !line.startsWith("- ")) continue;
    const match = GENERATED_NOTE_LINE.exec(line.replace(/^-\s/, "* "));
    if (match?.[1] && match[2] && match[3] && match[4]) {
      changes.push({
        title: match[1],
        author: match[2],
        pullRequestUrl: match[3],
        pullRequestNumber: Number(match[4]),
      });
    } else {
      changes.push({
        title: line.slice(2),
        author: null,
        pullRequestUrl: null,
        pullRequestNumber: null,
      });
    }
  }
  return changes;
}

const gmackoStamp = (version: string) => /-gmacko\.(\d{12})$/.exec(version)?.[1] ?? null;

export type NightlyShipStatus =
  | { readonly kind: "unshipped" }
  | { readonly kind: "installed"; readonly version: string }
  | { readonly kind: "newer"; readonly version: string };

/**
 * Whether the build this server runs includes a nightly, given the oldest
 * GMACKO build that shipped it. Dev builds (no GMACKO stamp) never count as
 * including anything.
 */
export function nightlyShipStatus(
  firstGmackoVersion: string | null,
  installedVersion: string,
): NightlyShipStatus {
  if (firstGmackoVersion === null) return { kind: "unshipped" };
  const shipped = gmackoStamp(firstGmackoVersion);
  const installed = gmackoStamp(installedVersion);
  if (shipped !== null && installed !== null && shipped <= installed) {
    return { kind: "installed", version: firstGmackoVersion };
  }
  return { kind: "newer", version: firstGmackoVersion };
}

export type ChangelogTab = "upstream" | "gmacko";

export const changelogAnchorId = (tab: ChangelogTab, version: string) =>
  `changelog-${tab}-${version.replaceAll(".", "-")}`;
