export type SettingsSectionPath =
  | "/settings/general"
  | "/settings/keybindings"
  | "/settings/providers"
  | "/settings/issues"
  | "/settings/source-control"
  | "/settings/connections"
  | "/settings/archived";

export const SETTINGS_NAV_ITEM_DEFINITIONS: ReadonlyArray<{
  readonly label: string;
  readonly to: SettingsSectionPath;
}> = [
  { label: "General", to: "/settings/general" },
  { label: "Keybindings", to: "/settings/keybindings" },
  { label: "Providers", to: "/settings/providers" },
  { label: "Issues", to: "/settings/issues" },
  { label: "Source Control", to: "/settings/source-control" },
  { label: "Connections", to: "/settings/connections" },
  { label: "Archive", to: "/settings/archived" },
];
