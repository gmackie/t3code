import { msg, useMessages } from "gt-react";
import type {
  GmackoChangelogBuild,
  GmackoChangelogInput,
  GmackoChangelogUpstreamNightly,
} from "@t3tools/contracts";
import { AlertTriangleIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { flushSync } from "react-dom";

import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  type ChangelogTab,
  changelogAnchorId,
  nightlyShipStatus,
  parseUpstreamChanges,
} from "./ChangelogSettings.logic";
import { SettingsGroup } from "./SettingsGroup";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

const shortSha = (sha: string) => sha.slice(0, 7);
const nightlyVersionOfTag = (tag: string) => tag.replace(/^v/, "");

function ReleaseHeader({
  version,
  url,
  publishedAt,
  children,
}: {
  version: string;
  url: string;
  publishedAt: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="text-sm font-medium text-foreground hover:underline"
      >
        {version}
      </a>
      {publishedAt ? (
        <span className="text-xs text-muted-foreground">
          {formatRelativeTimeLabel(publishedAt)}
        </span>
      ) : null}
      {children}
    </div>
  );
}

function UpstreamNightlyRow({
  nightly,
  installedVersion,
  onJump,
}: {
  nightly: GmackoChangelogUpstreamNightly;
  installedVersion: string;
  onJump: (tab: ChangelogTab, version: string) => void;
}) {
  const m = useMessages();

  const changes = useMemo(() => parseUpstreamChanges(nightly.bodyMarkdown), [nightly.bodyMarkdown]);
  const status = nightlyShipStatus(nightly.firstGmackoVersion, installedVersion);
  return (
    <div
      id={changelogAnchorId("upstream", nightly.version)}
      className="space-y-1.5 px-3 py-3 sm:px-4"
    >
      <ReleaseHeader version={nightly.version} url={nightly.url} publishedAt={nightly.publishedAt}>
        {status.kind === "unshipped" ? (
          <Badge variant="outline">{m(msg("Not in a GMACKO build yet"))}</Badge>
        ) : (
          <>
            <Badge variant={status.kind === "installed" ? "success" : "info"}>
              {status.kind === "installed"
                ? m(msg("In your build"))
                : m(msg("In a newer GMACKO build"))}
            </Badge>
            <span className="text-xs">
              <InlineButton tone="muted" onClick={() => onJump("gmacko", status.version)}>
                {m(msg("First shipped in "))}
                {status.version}
              </InlineButton>
            </span>
          </>
        )}
      </ReleaseHeader>
      {changes.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {changes.map((change, index) => (
            <li key={change.pullRequestUrl ?? index}>
              {change.title}
              {change.pullRequestUrl ? (
                <>
                  {" "}
                  <a
                    href={change.pullRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    #{change.pullRequestNumber}
                  </a>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{m(msg("No release notes."))}</p>
      )}
    </div>
  );
}

function GmackoBuildRow({
  build,
  installed,
  canJumpToNightly,
  onJump,
}: {
  build: GmackoChangelogBuild;
  installed: boolean;
  canJumpToNightly: boolean;
  onJump: (tab: ChangelogTab, version: string) => void;
}) {
  const m = useMessages();

  const nightlyVersion = build.upstreamNightlyTag
    ? nightlyVersionOfTag(build.upstreamNightlyTag)
    : null;
  return (
    <div id={changelogAnchorId("gmacko", build.version)} className="space-y-1.5 px-3 py-3 sm:px-4">
      <ReleaseHeader version={build.version} url={build.url} publishedAt={build.publishedAt}>
        {installed ? <Badge variant="success">{m(msg("Installed"))}</Badge> : null}
        {nightlyVersion ? (
          canJumpToNightly ? (
            <span className="text-xs">
              <InlineButton tone="muted" onClick={() => onJump("upstream", nightlyVersion)}>
                {m(msg("Includes upstream "))}
                {nightlyVersion}
              </InlineButton>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {m(msg("Includes upstream "))}
              {nightlyVersion}
            </span>
          )
        ) : build.upstreamBaseSha ? (
          <span className="text-xs text-muted-foreground">
            {m(msg("Upstream main at "))}
            {shortSha(build.upstreamBaseSha)}
          </span>
        ) : null}
      </ReleaseHeader>
      {!build.hasManifest ? (
        <p className="text-xs text-muted-foreground">
          {m(msg("No changelog was recorded for this build."))}
        </p>
      ) : build.changes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {m(msg("No fork changes since the previous build."))}
        </p>
      ) : (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {build.changes.map((change) =>
            change.kind === "pr" ? (
              <li key={change.sha}>
                <span className="text-foreground/80">PR {change.number}</span> · {change.title}
                {change.commits.length > 1 || change.omittedCommits > 0 ? (
                  <details className="mt-0.5 pl-3">
                    <summary className="cursor-pointer">
                      {change.commits.length + change.omittedCommits} commits
                    </summary>
                    <ul className="space-y-0.5 pt-0.5">
                      {change.commits.map((commit) => (
                        <li key={commit.sha}>
                          {commit.subject} <code>{shortSha(commit.sha)}</code>
                        </li>
                      ))}
                      {change.omittedCommits > 0 ? (
                        <li>
                          {m(msg("…and "))}
                          {change.omittedCommits} more
                        </li>
                      ) : null}
                    </ul>
                  </details>
                ) : null}
              </li>
            ) : (
              <li key={change.sha}>
                {change.subject} <code>{shortSha(change.sha)}</code>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * GMACKO fork changelog: upstream nightlies and the fork's own builds,
 * cross-linked by which build first shipped each nightly.
 */
export function ChangelogSettingsPanel() {
  const m = useMessages();

  const { environment } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  // A forced refresh is a different query input, so the server skips its cache.
  const [input, setInput] = useState<GmackoChangelogInput>({});
  const { data, error, isPending, refresh } = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.gmackoChangelog({ environmentId, input }),
  );
  const [tab, setTab] = useState<ChangelogTab>("upstream");
  // Render the other tab synchronously so its row exists to scroll to.
  const jump = (target: ChangelogTab, version: string) => {
    flushSync(() => setTab(target));
    document.getElementById(changelogAnchorId(target, version))?.scrollIntoView({ block: "start" });
  };
  const upstreamVersions = useMemo(
    () => new Set(data?.upstream.map((nightly) => nightly.version)),
    [data?.upstream],
  );
  const loadError = data?.error ?? error;
  const refreshAction = (
    <Button
      size="icon-xs"
      variant="ghost-muted"
      disabled={isPending}
      aria-label={m(msg("Refresh changelog"))}
      onClick={() => (input.refresh ? refresh() : setInput({ refresh: true }))}
    >
      <RefreshIcon refreshing={isPending} />
    </Button>
  );

  return (
    <SettingsPageContainer>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4">
        <ToggleGroup
          aria-label={m(msg("Changelog source"))}
          variant="segmented"
          value={[tab]}
          onValueChange={(next) => {
            if (next[0] === "upstream" || next[0] === "gmacko") setTab(next[0]);
          }}
        >
          <Toggle value="upstream">{m(msg("Upstream nightly"))}</Toggle>
          <Toggle value="gmacko">{m(msg("GMACKO builds"))}</Toggle>
        </ToggleGroup>
        {data?.fetchedAt ? (
          <span className="text-xs text-muted-foreground">
            {m(msg("Updated "))}
            {formatRelativeTimeLabel(data.fetchedAt)}
          </span>
        ) : null}
      </div>
      {loadError ? (
        <div className="flex items-start gap-2 px-3 text-xs text-destructive sm:px-4">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{loadError}</span>
        </div>
      ) : null}
      {tab === "upstream" ? (
        <SettingsSection title={m(msg("Upstream nightlies"))} headerAction={refreshAction}>
          <SettingsGroup>
            {data && data.upstream.length > 0 ? (
              data.upstream.map((nightly) => (
                <UpstreamNightlyRow
                  key={nightly.tag}
                  nightly={nightly}
                  installedVersion={data.installedVersion}
                  onJump={jump}
                />
              ))
            ) : (
              <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
                {isPending ? m(msg("Loading releases…")) : m(msg("No upstream nightlies found."))}
              </p>
            )}
          </SettingsGroup>
        </SettingsSection>
      ) : (
        <SettingsSection title={m(msg("GMACKO builds"))} headerAction={refreshAction}>
          <SettingsGroup>
            {data && data.builds.length > 0 ? (
              data.builds.map((build) => (
                <GmackoBuildRow
                  key={build.tag}
                  build={build}
                  installed={build.version === data.installedVersion}
                  canJumpToNightly={
                    build.upstreamNightlyTag !== null &&
                    upstreamVersions.has(nightlyVersionOfTag(build.upstreamNightlyTag))
                  }
                  onJump={jump}
                />
              ))
            ) : (
              <p className="px-3 py-3 text-xs text-muted-foreground sm:px-4">
                {isPending ? m(msg("Loading releases…")) : m(msg("No GMACKO builds found."))}
              </p>
            )}
          </SettingsGroup>
        </SettingsSection>
      )}
    </SettingsPageContainer>
  );
}
