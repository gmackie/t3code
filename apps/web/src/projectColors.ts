import { PROJECT_COLOR_PRESETS, type ProjectColor, type ProjectColorPreset } from "./uiStateStore";

export const PROJECT_COLOR_LABELS: Record<ProjectColorPreset, string> = {
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

export const PROJECT_COLOR_VALUES: Record<ProjectColorPreset, string> = {
  red: "#ef4444",
  orange: "#f97316",
  yellow: "#eab308",
  green: "#22c55e",
  blue: "#3b82f6",
  purple: "#a855f7",
  pink: "#ec4899",
};

export const PROJECT_COLOR_FOREGROUND_VALUES: Record<ProjectColorPreset, string> = {
  red: "#ffffff",
  orange: "#111827",
  yellow: "#111827",
  green: "#052e16",
  blue: "#ffffff",
  purple: "#ffffff",
  pink: "#ffffff",
};

const projectColorPresetSet = new Set<string>(PROJECT_COLOR_PRESETS);

export function isProjectColorPreset(color: ProjectColor): color is ProjectColorPreset {
  return projectColorPresetSet.has(color);
}

export function resolveProjectColorValue(color: ProjectColor): string {
  return isProjectColorPreset(color) ? PROJECT_COLOR_VALUES[color] : color;
}

export function resolveProjectColorForegroundValue(color: ProjectColor): string {
  if (isProjectColorPreset(color)) {
    return PROJECT_COLOR_FOREGROUND_VALUES[color];
  }

  const r = Number.parseInt(color.slice(1, 3), 16) / 255;
  const g = Number.parseInt(color.slice(3, 5), 16) / 255;
  const b = Number.parseInt(color.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.62 ? "#111827" : "#ffffff";
}
