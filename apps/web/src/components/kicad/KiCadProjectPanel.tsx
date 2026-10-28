/* eslint-disable react/iframe-missing-sandbox -- The bundled CAD runtime needs same-origin module and worker access. */
import { WorkspaceModeSwitcher } from "../chat/WorkspaceModeSwitcher";
import type { ScopedThreadRef } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { kicadState } from "~/state/kicad";
import { useEnvironmentQuery } from "~/state/query";
import { usePreparedConnection } from "~/state/session";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";
import { openUrlInPreview } from "~/browser/openFileInPreview";

import { PreviewPanelShell, type PreviewPanelMode } from "../preview/PreviewPanelShell";

export interface KiCadProjectPanelProps {
  readonly mode: PreviewPanelMode;
  readonly threadRef: ScopedThreadRef;
  readonly projectPath: string | null;
}

export function KiCadProjectPanel({ mode, threadRef, projectPath }: KiCadProjectPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const connection = usePreparedConnection(threadRef.environmentId);
  const sessionQuery = useEnvironmentQuery(
    projectPath
      ? kicadState.session({ environmentId: threadRef.environmentId, cwd: projectPath })
      : null,
  );
  const session = sessionQuery.data;
  const error = !projectPath
    ? "Open a KiCad project to inspect it here."
    : Option.isNone(connection)
      ? "Reconnect to this environment to open the KiCad viewer."
      : sessionQuery.error;
  const refreshSession = sessionQuery.refresh;

  const sendTheme = useCallback(() => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    const styles = getComputedStyle(document.documentElement);
    const variables: Record<string, string> = {};
    for (let index = 0; index < styles.length; index += 1) {
      const key = styles.item(index);
      if (key.startsWith("--")) variables[key] = styles.getPropertyValue(key).trim();
    }
    // The host document is served by this client; the API origin in the hash
    // can be remote, but it is not the iframe's postMessage target.
    const targetOrigin = window.location.origin === "null" ? "*" : window.location.origin;
    frame.postMessage(
      {
        type: "k3eda-theme",
        dark: document.documentElement.classList.contains("dark"),
        variables,
      },
      targetOrigin,
    );
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Observe the host document palette to update the mounted CAD iframe, disconnecting the observer on unmount.
  useEffect(() => {
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, [sendTheme]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Renew the mounted CAD iframe's access before its ticket expires and release the renewal timer on unmount.
  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(
      refreshSession,
      Math.max(1_000, session.expiresAt - Date.now() - 60_000),
    );
    return () => window.clearTimeout(timer);
  }, [session, refreshSession]);

  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const viewerUrl = session
    ? (() => {
        const url = new URL("/kicad.html", window.location.href);
        url.hash = new URLSearchParams({
          api: Option.isSome(connection) ? connection.value.httpBaseUrl : window.location.origin,
          token: session.token,
          view: "pcb",
          embedded: "1",
        }).toString();
        return url.toString();
      })()
    : null;
  const openInBrowser = useCallback(() => {
    if (!viewerUrl) return;
    const target = new URL(viewerUrl);
    // The browser surface cannot load the desktop renderer's private protocol.
    if (!/^https?:$/.test(target.protocol) && Option.isSome(connection)) {
      const hosted = new URL(`${connection.value.httpBaseUrl.replace(/\/$/, "")}/kicad.html`);
      hosted.hash = target.hash;
      void openUrlInPreview({ threadRef, url: hosted.toString(), openPreview });
    } else {
      void openUrlInPreview({ threadRef, url: viewerUrl, openPreview });
    }
  }, [connection, openPreview, threadRef, viewerUrl]);
  return (
    <PreviewPanelShell mode={mode} widthStorageKey="t3code:kicad-panel-width" defaultWidth={620}>
      <div className="flex h-full min-h-0 flex-col bg-background" data-kicad-panel>
        <div className="flex min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
          <WorkspaceModeSwitcher threadRef={threadRef} />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {projectPath?.split(/[\\/]/).findLast(Boolean) ?? "Current project"}
          </span>
          <span className="rounded border border-border px-1 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            read-only
          </span>
          <button
            type="button"
            disabled={!viewerUrl}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
            onClick={openInBrowser}
            aria-label="Open KiCad viewer in browser"
          >
            <ExternalLink className="size-3.5" />
          </button>
        </div>
        <div className="relative min-h-0 flex-1 bg-[#101214]">
          {viewerUrl ? (
            <iframe
              sandbox="allow-scripts allow-same-origin allow-downloads allow-popups allow-forms"
              ref={iframeRef}
              onLoad={sendTheme}
              title="KiCad project viewer"
              src={viewerUrl}
              className="block h-full w-full border-0"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
              {error ? (
                <>
                  <span>{error}</span>
                  <button
                    type="button"
                    className="rounded-md bg-accent px-2 py-1 text-foreground hover:bg-accent/80"
                    onClick={refreshSession}
                  >
                    Retry
                  </button>
                </>
              ) : (
                <>Opening viewer…</>
              )}
            </div>
          )}
        </div>
      </div>
    </PreviewPanelShell>
  );
}
