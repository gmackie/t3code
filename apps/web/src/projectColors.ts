import type { ProjectColor } from "./uiStateStore";

export const PROJECT_COLOR_LABELS: Record<ProjectColor, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

export const PROJECT_COLOR_VALUES: Record<ProjectColor, string> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
};

export const PROJECT_COLOR_FOREGROUND_VALUES: Record<ProjectColor, string> = {
  red: "#ffffff",
  orange: "#111827",
  yellow: "#111827",
  green: "#052e16",
  blue: "#ffffff",
  purple: "#ffffff",
  pink: "#ffffff",
};
