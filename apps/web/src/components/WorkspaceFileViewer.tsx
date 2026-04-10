import type { EnvironmentId, ProjectReadFileResult } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  getHighlightedCodeHtmlPromise,
  resolveCodeLanguageFromPath,
  resolveCodeThemeName,
} from "../lib/codeHighlighting";
import {
  projectCodeDefinitionsQueryOptions,
  projectCodeHoverQueryOptions,
  projectReadFileQueryOptions,
} from "../lib/projectReactQuery";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

interface WorkspaceFileViewerProps {
  cwd: string;
  relativePath: string;
  line: number | null;
  column: number | null;
  theme: "light" | "dark";
  wordWrap: boolean;
  environmentId?: EnvironmentId | null;
  onOpenLocation?: (input: { relativePath: string; line: number; column: number }) => void;
}

function isLikelyBinary(contents: string): boolean {
  return contents.includes("\u0000");
}

function extractHighlightedLineHtml(highlightedHtml: string): string[] {
  if (typeof DOMParser === "undefined") {
    return highlightedHtml.length > 0 ? [highlightedHtml] : [""];
  }

  const parsedDocument = new DOMParser().parseFromString(highlightedHtml, "text/html");
  const lineElements = Array.from(parsedDocument.querySelectorAll(".line"));
  if (lineElements.length > 0) {
    return lineElements.map((lineElement) => lineElement.innerHTML);
  }

  const codeText = parsedDocument.querySelector("code")?.textContent;
  if (codeText) {
    return codeText.split("\n");
  }

  return [""];
}

function FileViewerPlainText(props: { contents: string; wordWrap: boolean }) {
  return (
    <pre
      className={cn(
        "min-h-full px-4 py-4 font-mono text-[12px] leading-6 text-foreground sm:px-6",
        props.wordWrap ? "overflow-auto whitespace-pre-wrap wrap-break-word" : "overflow-x-auto",
      )}
    >
      {props.contents}
    </pre>
  );
}

function HighlightedFileViewerBody(props: {
  contents: string;
  relativePath: string;
  theme: "light" | "dark";
  wordWrap: boolean;
  initialSelectedLineNumber: number | null;
}) {
  const [hoveredLineNumber, setHoveredLineNumber] = useState<number | null>(null);
  const [selectedLineNumber, setSelectedLineNumber] = useState<number | null>(
    props.initialSelectedLineNumber,
  );
  const highlightedCodeQuery = useQuery({
    queryKey: [
      "workspace-file-viewer",
      "highlighted-code",
      props.relativePath,
      props.theme,
      props.contents,
    ],
    queryFn: () =>
      getHighlightedCodeHtmlPromise({
        code: props.contents,
        language: resolveCodeLanguageFromPath(props.relativePath),
        themeName: resolveCodeThemeName(props.theme),
      }),
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    setHoveredLineNumber(null);
    setSelectedLineNumber(props.initialSelectedLineNumber);
  }, [props.initialSelectedLineNumber, props.relativePath]);

  const highlightedLines = useMemo(
    () =>
      highlightedCodeQuery.data ? extractHighlightedLineHtml(highlightedCodeQuery.data) : null,
    [highlightedCodeQuery.data],
  );
  const highlightedLineRecords = useMemo(() => {
    if (!highlightedLines) {
      return null;
    }

    const countsByLineHtml = new Map<string, number>();
    let lineNumber = 0;
    return highlightedLines.map((lineHtml) => {
      lineNumber += 1;
      const occurrence = (countsByLineHtml.get(lineHtml) ?? 0) + 1;
      countsByLineHtml.set(lineHtml, occurrence);
      return {
        key: `${lineHtml}:${occurrence}`,
        lineHtml,
        lineNumber,
      };
    });
  }, [highlightedLines]);

  if (!highlightedLineRecords) {
    return <FileViewerPlainText contents={props.contents} wordWrap={props.wordWrap} />;
  }

  return (
    <div className="min-h-full overflow-auto">
      <div
        className={cn(
          "min-h-full font-mono text-[12px] leading-6",
          props.wordWrap ? "" : "min-w-max",
        )}
        data-testid="workspace-file-viewer-code"
      >
        <div className="py-4" data-testid="workspace-file-viewer-line-numbers">
          {highlightedLineRecords.map((lineRecord) => {
            const isSelectedLine = selectedLineNumber === lineRecord.lineNumber;
            const isHoveredLine = hoveredLineNumber === lineRecord.lineNumber;
            return (
              <div
                key={`line-row-${lineRecord.key}`}
                className={cn(
                  "grid grid-cols-[max-content_minmax(0,1fr)] transition-colors",
                  isSelectedLine ? "bg-accent/55" : isHoveredLine ? "bg-accent/30" : null,
                )}
                data-line-number={lineRecord.lineNumber}
                data-selected={isSelectedLine ? "true" : "false"}
                data-testid="workspace-file-viewer-code-row"
                onClick={() => setSelectedLineNumber(lineRecord.lineNumber)}
                onMouseEnter={() => setHoveredLineNumber(lineRecord.lineNumber)}
                onMouseLeave={() =>
                  setHoveredLineNumber((current) =>
                    current === lineRecord.lineNumber ? null : current,
                  )
                }
              >
                <div
                  className={cn(
                    "sticky left-0 z-10 border-r border-border/80 px-3 text-right text-muted-foreground/70 select-none sm:px-4",
                    isSelectedLine
                      ? "bg-accent/55 text-foreground/85"
                      : isHoveredLine
                        ? "bg-accent/30 text-muted-foreground"
                        : "bg-background/95",
                  )}
                  data-testid="workspace-file-viewer-line-number"
                >
                  {lineRecord.lineNumber}
                </div>
                <div
                  className={cn(
                    "px-4 sm:px-6",
                    props.wordWrap ? "whitespace-pre-wrap wrap-break-word" : "whitespace-pre",
                  )}
                  data-testid="workspace-file-viewer-code-line"
                  style={
                    props.wordWrap
                      ? { overflowWrap: "anywhere", wordBreak: "break-word" }
                      : undefined
                  }
                  dangerouslySetInnerHTML={{
                    __html: lineRecord.lineHtml.length > 0 ? lineRecord.lineHtml : "&nbsp;",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function FileViewerBody(props: {
  result: ProjectReadFileResult | undefined;
  errorMessage: string | null;
  relativePath: string;
  theme: "light" | "dark";
  wordWrap: boolean;
  line: number | null;
}) {
  if (props.errorMessage) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-destructive">
        {props.errorMessage}
      </div>
    );
  }

  const contents = props.result?.contents ?? "";
  if (isLikelyBinary(contents)) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        Binary files are not supported in the in-app viewer yet.
      </div>
    );
  }

  return (
    <HighlightedFileViewerBody
      contents={contents}
      relativePath={props.relativePath}
      theme={props.theme}
      wordWrap={props.wordWrap}
      initialSelectedLineNumber={props.line}
    />
  );
}

export default function WorkspaceFileViewer({
  cwd,
  relativePath,
  line,
  column,
  theme,
  wordWrap,
  environmentId = null,
  onOpenLocation,
}: WorkspaceFileViewerProps) {
  const fileQuery = useQuery(
    projectReadFileQueryOptions({
      environmentId,
      cwd,
      relativePath,
    }),
  );
  const hoverQuery = useQuery(
    projectCodeHoverQueryOptions({
      environmentId,
      cwd,
      relativePath,
      line,
      column,
      enabled: line !== null && column !== null,
    }),
  );
  const definitionsQuery = useQuery(
    projectCodeDefinitionsQueryOptions({
      environmentId,
      cwd,
      relativePath,
      line,
      column,
      enabled: line !== null && column !== null,
    }),
  );
  const primaryDefinition = definitionsQuery.data?.definitions[0] ?? null;
  const hoverText = hoverQuery.data?.hover?.contents ?? null;

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="workspace-file-viewer"
    >
      {hoverText ? (
        <div
          className="pointer-events-auto absolute top-3 right-3 z-20 max-w-md rounded-md border border-border/80 bg-card/95 px-3 py-2 shadow-lg backdrop-blur"
          data-testid="workspace-file-viewer-hover-card"
        >
          <div className="whitespace-pre-wrap font-mono text-[11px] leading-5 text-foreground">
            {hoverText}
          </div>
          {primaryDefinition && onOpenLocation ? (
            <div className="mt-2 flex justify-end">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  onOpenLocation({
                    relativePath: primaryDefinition.relativePath,
                    line: primaryDefinition.line,
                    column: primaryDefinition.column,
                  })
                }
              >
                Go to definition
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto bg-background">
        {fileQuery.isLoading ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" />
            Loading file contents...
          </div>
        ) : (
          <FileViewerBody
            result={fileQuery.data}
            errorMessage={fileQuery.error instanceof Error ? fileQuery.error.message : null}
            relativePath={relativePath}
            theme={theme}
            wordWrap={wordWrap}
            line={line}
          />
        )}
      </div>
    </div>
  );
}
