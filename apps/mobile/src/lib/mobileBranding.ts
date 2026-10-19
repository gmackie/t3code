export type MobileStageLabel = "Beta" | "Dev" | "Nightly";

export function resolveMobileStageLabel(appVariant: unknown): MobileStageLabel {
  if (appVariant === "development") return "Dev";
  if (appVariant === "preview" || appVariant === "gmacko") return "Nightly";
  return "Beta";
}
