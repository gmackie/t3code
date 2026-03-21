import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "../../proposedPlan";

export interface PlanningTaskDraft {
  id: string;
  title: string;
}

function stripFencedCodeBlocks(text: string): string {
  return text.replace(/^(`{3,}|~{3,}).*\n[\s\S]*?\n\1\s*$/gm, "");
}

function collectPlanListItems(planMarkdown: string): string[] {
  const content = stripFencedCodeBlocks(stripDisplayedPlanMarkdown(planMarkdown));
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
  const goal = proposedPlanTitle(planMarkdown) ?? "Planning workbench artifact";
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
