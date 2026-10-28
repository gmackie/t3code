import type { ScopedThreadRef } from "@t3tools/contracts";
import { environmentEndpointUrl } from "@t3tools/client-runtime/environment";
import * as Option from "effect/Option";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHtmlRenderTheme } from "~/hooks/useHtmlRenderTheme";
import { useClientSettings } from "~/hooks/useSettings";
import { gameState } from "~/state/game";
import { useEnvironmentQuery } from "~/state/query";
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the embedded Unity document's theme in step with the client palette.
  useEffect(postTheme, [postTheme]);
  const connection = usePreparedConnection(threadRef.environmentId);
  const ticketQuery = useEnvironmentQuery(
    projectPath
      ? gameState.session({
          environmentId: threadRef.environmentId,
          threadId: threadRef.threadId,
          cwd: projectPath,
        })
      : null,
  );
  const ticket = ticketQuery.data;
  const error = projectPath ? ticketQuery.error : "Open a project to connect to Unity.";
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
