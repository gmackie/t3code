import type { GameViewerTicket, ScopedThreadRef } from "@t3tools/contracts";
import { environmentEndpointUrl } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHtmlRenderTheme } from "~/hooks/useHtmlRenderTheme";
import { useClientSettings } from "~/hooks/useSettings";
import { gameState } from "~/state/game";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { usePreparedConnection } from "~/state/session";

export function GameProjectPanel({
  threadRef,
  projectPath,
}: {
  threadRef: ScopedThreadRef;
  projectPath: string | null;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const palette = useHtmlRenderTheme();
  const fontSize = useClientSettings((settings) => settings.fontSizeInterface);
  const fontSmoothing = useClientSettings((settings) => settings.fontSmoothing);
  const theme = useMemo(
    () => ({
      ...palette,
      variables: {
        ...palette.variables,
        "--game-font-size": `${fontSize}px`,
        "--game-font-smoothing": fontSmoothing ? "antialiased" : "auto",
      },
    }),
    [palette, fontSize, fontSmoothing],
  );
  const [initialTheme] = useState(theme);
  const postTheme = useCallback(() => {
    const view = frame.current;
    if (view)
      view.contentWindow?.postMessage({ type: "t3-game-theme", theme }, new URL(view.src).origin);
  }, [theme]);
  useEffect(postTheme, [postTheme]);
  const [ticket, setTicket] = useState<typeof GameViewerTicket.Type | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connection = usePreparedConnection(threadRef.environmentId);
  const mint = useAtomQueryRunner(gameState.session, { refresh: true, reportFailure: false });
  useEffect(() => {
    let cancelled = false;
    setTicket(null);
    setError(null);
    if (!projectPath) {
      setError("Open a project to connect to Unity.");
      return;
    }
    void mint({
      environmentId: threadRef.environmentId,
      threadId: threadRef.threadId,
      cwd: projectPath,
    })
      .then((result) => {
        if (cancelled) return;
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        setTicket(result.value);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Unable to open Unity viewer.");
      });
    return () => {
      cancelled = true;
    };
  }, [mint, projectPath, threadRef.environmentId, threadRef.threadId]);
  if (error) return <p role="alert">{error}</p>;
  if (!ticket || Option.isNone(connection)) return <p role="status">Opening Unity viewer…</p>;
  const url = new URL(environmentEndpointUrl(connection.value.httpBaseUrl, "/api/game/viewer"));
  url.hash = new URLSearchParams({
    ticket: ticket.token,
    gameTheme: JSON.stringify(initialTheme),
  }).toString();
  return (
    <iframe
      ref={frame}
      onLoad={postTheme}
      title="Unity game viewer"
      src={url.toString()}
      sandbox="allow-scripts allow-same-origin allow-pointer-lock"
      allow="gamepad"
      referrerPolicy="no-referrer"
      className="h-full w-full border-0"
    />
  );
}
