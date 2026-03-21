/**
 * Pure logic for the planning workbench extension.
 * No React, no DOM, no app-specific imports — just string processing.
 */

export interface PlanningTaskDraft {
  id: string;
  title: string;
}

function stripFencedCodeBlocks(text: string): string {
  return text.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?\n\1\s*$/gm, "");
}

function extractPlanTitle(planMarkdown: string): string | null {
  const heading = planMarkdown.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]?.trim();
  return heading && heading.length > 0 ? heading : null;
}

function stripTitleAndSummary(planMarkdown: string): string {
  const lines = planMarkdown.trimEnd().split(/\r?\n/);
  const sourceLines = lines[0] && /^\s{0,3}#{1,6}\s+/.test(lines[0]) ? lines.slice(1) : [...lines];
  while (sourceLines[0]?.trim().length === 0) {
    sourceLines.shift();
  }
  const firstHeadingMatch = sourceLines[0]?.match(/^\s{0,3}#{1,6}\s+(.+)$/);
  if (firstHeadingMatch?.[1]?.trim().toLowerCase() === "summary") {
    sourceLines.shift();
    while (sourceLines[0]?.trim().length === 0) {
      sourceLines.shift();
    }
  }
  return sourceLines.join("\n");
}

export function collectPlanListItems(planMarkdown: string): string[] {
  const content = stripFencedCodeBlocks(stripTitleAndSummary(planMarkdown));
  const matches = content.matchAll(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/gm);
  const items: string[] = [];

  for (const match of matches) {
    const candidate = match[1]?.trim();
    if (!candidate) continue;
    if (!items.includes(candidate)) {
      items.push(candidate);
    }
  }

  return items;
}

export function buildPlanningRequirementsMarkdown(planMarkdown: string): string {
  const goal = extractPlanTitle(planMarkdown) ?? "Planning workbench artifact";
  const items = collectPlanListItems(planMarkdown);
  const requirementLines =
    items.length > 0 ? items.map((item) => `- ${item}`) : ["- Review and refine the proposed plan"];

  return `# Requirements

## Goal
${goal}

## Functional Requirements
${requirementLines.join("\n")}
`;
}

export function buildPlanningTaskDrafts(planMarkdown: string): PlanningTaskDraft[] {
  return collectPlanListItems(planMarkdown).map((item, index) => ({
    id: `task-${index + 1}`,
    title: item,
  }));
}
