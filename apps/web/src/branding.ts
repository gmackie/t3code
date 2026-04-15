export const APP_BASE_NAME = "T3 Code";

export function resolveAppStageLabel(input: { isDevelopment: boolean }): string {
  return input.isDevelopment ? "Dev" : "GMACKO";
}

export function resolveAppDisplayName(input: { isDevelopment: boolean }): string {
  return `${APP_BASE_NAME} (${resolveAppStageLabel(input)})`;
}

export const APP_STAGE_LABEL = resolveAppStageLabel({ isDevelopment: import.meta.env.DEV });
export const APP_DISPLAY_NAME = resolveAppDisplayName({ isDevelopment: import.meta.env.DEV });
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
