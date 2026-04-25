export function createFilePreviewModel(input: {
  readonly path: string;
  readonly language?: string;
  readonly contents: string;
}): {
  readonly path: string;
  readonly language: string | null;
  readonly lines: ReadonlyArray<{ readonly id: string; readonly text: string }>;
} {
  const seenLineCounts = new Map<string, number>();

  return {
    path: input.path,
    language: input.language ?? null,
    lines: input.contents
      .split("\n")
      .slice(0, 12)
      .map((line) => {
        const occurrence = seenLineCounts.get(line) ?? 0;
        seenLineCounts.set(line, occurrence + 1);
        return {
          id: `${occurrence}:${line}`,
          text: line,
        };
      }),
  };
}
