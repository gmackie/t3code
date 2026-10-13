export type MarkdownSegment =
  | { readonly kind: "markdown"; readonly markdown: string }
  | {
      readonly kind: "mermaid";
      /** Diagram source between the fences. */
      readonly source: string;
      /** The complete fenced block, rendered as markdown for the source view. */
      readonly fence: string;
    };

const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface OpenFence {
  readonly marker: string;
  readonly mermaid: boolean;
  readonly start: number;
}

function closesFence(line: string, fence: OpenFence): boolean {
  const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return (
    match !== null && match[1]![0] === fence.marker[0] && match[1]!.length >= fence.marker.length
  );
}

/**
 * Splits markdown at top-level ```mermaid fences so diagrams can render
 * outside the native markdown view. Other fences, including longer fences
 * that contain a mermaid example, stay in the surrounding markdown. An
 * unclosed mermaid fence runs to the end, matching CommonMark and streaming.
 */
export function splitMermaidMarkdown(markdown: string): ReadonlyArray<MarkdownSegment> {
  if (!/mermaid/i.test(markdown)) return [{ kind: "markdown", markdown }];
  const lines = markdown.split("\n");
  const segments: MarkdownSegment[] = [];
  let proseStart = 0;
  let fence: OpenFence | null = null;

  const pushProse = (end: number) => {
    const prose = lines.slice(proseStart, end).join("\n");
    if (prose.trim().length > 0) segments.push({ kind: "markdown", markdown: prose });
  };
  const pushMermaid = (open: OpenFence, end: number, closed: boolean) => {
    segments.push({
      kind: "mermaid",
      source: lines.slice(open.start + 1, closed ? end : end + 1).join("\n"),
      fence: lines.slice(open.start, end + 1).join("\n"),
    });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (fence) {
      if (!closesFence(line, fence)) continue;
      if (fence.mermaid) {
        pushMermaid(fence, index, true);
        proseStart = index + 1;
      }
      fence = null;
      continue;
    }
    const match = OPENING_FENCE.exec(line);
    if (!match) continue;
    const marker = match[1]!;
    const info = match[2]!.trim();
    // CommonMark: a backtick fence's info string cannot contain backticks.
    if (marker[0] === "`" && info.includes("`")) continue;
    const mermaid = info.split(/\s+/)[0]!.toLowerCase() === "mermaid";
    fence = { marker, mermaid, start: index };
    if (mermaid) pushProse(index);
  }

  if (fence?.mermaid) {
    pushMermaid(fence, lines.length - 1, false);
  } else {
    pushProse(lines.length);
  }
  return segments.length > 0 ? segments : [{ kind: "markdown", markdown }];
}
