import {
  ArchiveIcon,
  ArchiveX,
  InfoIcon,
  LoaderIcon,
  PlusIcon,
  RefreshCwIcon,
  SettingsIcon,
  TerminalIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type BackgroundActivityProfile,
  type DesktopUpdateChannel,
  ProviderDriverKind,
  type ScopedThreadRef,
  type SidebarProjectGroupingMode,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
  DEFAULT_UNIFIED_SETTINGS,
  type EnvironmentIdentificationMode,
  MAX_CODE_FONT_SIZE,
  MAX_GLASS_OPACITY,
  MAX_INTERFACE_FONT_SIZE,
  MAX_PROMPT_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_CODE_FONT_SIZE,
  MIN_GLASS_OPACITY,
  MIN_INTERFACE_FONT_SIZE,
  MIN_PROMPT_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
} from "@t3tools/contracts/settings";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import { createModelSelection } from "@t3tools/shared/model";
import * as Duration from "effect/Duration";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { APP_VERSION, HOSTED_APP_CHANNEL, HOSTED_APP_CHANNEL_LABEL } from "../../branding";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktopUpdate.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import {
  resolveEnvironmentIdentificationPillLabel,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { isElectron } from "../../env";
import { buildHostedChannelSelectionUrl, type HostedAppChannel } from "../../hostedPairing";
import { useCustomThemes } from "../../hooks/useCustomThemes";
import {
  readAppearanceModePreference,
  readThemeHalves,
  readThemePreference,
  useTheme,
} from "../../hooks/useTheme";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { usePrimaryEnvironment } from "../../state/environments";
import { useThreadActions } from "../../hooks/useThreadActions";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { isMacPlatform } from "../../lib/utils";
import { primaryServerObservabilityAtom, primaryServerProvidersAtom } from "../../state/server";
import { useProjects } from "../../state/entities";
import { useServerConfigs } from "../../state/entities";
import { useArchivedThreadSnapshots } from "../../lib/archivedThreadsState";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { DraftInput } from "../ui/draft-input";
import { Input } from "../ui/input";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThemeLibrary } from "./ThemeSettings";
import {
  backgroundActivityOverrideSettings,
  backgroundActivitySharedPolicySettings,
  buildProviderInstanceUpdatePatch,
  DESKTOP_UPDATE_CHANNEL_OPTIONS,
  durationToSeconds,
  formatDiagnosticsDescription,
  normalizeIntervalSeconds,
  PROVIDER_HEALTH_INTERVAL_STEP_SECONDS,
  hasChangedBackgroundActivitySettings,
  isProjectGroupingEnabled,
  projectGroupingModeFromToggle,
  readLastEnabledProjectGroupingMode,
  rememberEnabledProjectGroupingMode,
  resolveBackgroundActivityProfileOption,
} from "./SettingsPanels.logic";
import {
  PolicyTooltip,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useSettingsSearchTargetId,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { ProjectFavicon } from "../ProjectFavicon";

const ENVIRONMENT_IDENTIFICATION_LABELS: Record<EnvironmentIdentificationMode, string> = {
  artwork: "Artwork",
  pill: "Version pill",
  none: "None",
};

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

const BACKGROUND_ACTIVITY_PROFILE_LABELS: Record<BackgroundActivityProfile, string> = {
  balanced: "Balanced",
  performance: "Performance",
  "battery-saver": "Battery saver",
};

type BackgroundActivityProfileOption = BackgroundActivityProfile | "advanced";

const BACKGROUND_ACTIVITY_PROFILE_OPTION_LABELS: Record<BackgroundActivityProfileOption, string> = {
  ...BACKGROUND_ACTIVITY_PROFILE_LABELS,
  advanced: "Advanced",
};

const BACKGROUND_ACTIVITY_PROFILE_DESCRIPTIONS: Record<BackgroundActivityProfile, string> = {
  balanced:
    "Pauses background probes when clients are idle, the host is locked, or low power mode is active.",
  performance: "Allows scoped background probes while any subscribed client remains connected.",
  "battery-saver": "Also pauses background probes when the host or client is on battery.",
};

const ADVANCED_BACKGROUND_ACTIVITY_DESCRIPTION =
  "Uses custom background intervals with the selected shared power policy.";

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
const BACKGROUND_ACTIVITY_BOOLEAN_OVERRIDES: ReadonlyArray<{
  readonly key:
    | "pauseWhenHostLocked"
    | "pauseWhenHostLowPower"
    | "pauseWhenClientLowPower"
    | "pauseWhenOnBattery";
  readonly label: string;
}> = [
  { key: "pauseWhenHostLocked", label: "Pause when host is locked" },
  { key: "pauseWhenHostLowPower", label: "Pause on host low power" },
  { key: "pauseWhenClientLowPower", label: "Pause on client low power" },
  { key: "pauseWhenOnBattery", label: "Pause on battery" },
];

function resetBackgroundActivitySettings() {
  return {
    backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
  };
}

function backgroundActivityProfileSettings(profile: BackgroundActivityProfile) {
  return {
    backgroundActivity: {
      schemaVersion: 1 as const,
      profile,
      overrides: {},
    },
  };
}

function AboutVersionTitle() {
  return (
    <span className="inline-flex items-center gap-2">
      <span>Version</span>
      <code className="text-[11px] font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  const updateState = useDesktopUpdateState();
  const [isChangingUpdateChannel, setIsChangingUpdateChannel] = useState(false);

  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const selectedUpdateChannel = updateState?.channel ?? "latest";
  const selectedUpdateChannelLabel =
    DESKTOP_UPDATE_CHANNEL_OPTIONS.find((option) => option.value === selectedUpdateChannel)
      ?.label ?? "Stable";
  const selectedHostedAppChannel = hasDesktopBridge ? null : HOSTED_APP_CHANNEL;

  const handleUpdateChannelChange = useCallback(
    (channel: DesktopUpdateChannel) => {
      const bridge = window.desktopBridge;
      if (
        !bridge ||
        typeof bridge.setUpdateChannel !== "function" ||
        channel === selectedUpdateChannel
      ) {
        return;
      }

      setIsChangingUpdateChannel(true);
      void bridge
        .setUpdateChannel(channel)
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not change update track",
              description: error instanceof Error ? error.message : "Update track change failed.",
            }),
          );
        })
        .finally(() => {
          setIsChangingUpdateChannel(false);
        });
    },
    [selectedUpdateChannel],
  );

  const handleButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void bridge.downloadUpdate().catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not download update",
            description: error instanceof Error ? error.message : "Download failed.",
          }),
        );
      });
      return;
    }

    if (action === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(
          updateState ?? { availableVersion: null, downloadedVersion: null },
          navigator.platform,
        ),
      );
      if (!confirmed) return;
      void bridge.installUpdate().catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "Install failed.",
          }),
        );
      });
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (!result.checked) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not check for updates",
              description:
                result.state.message ?? "Automatic updates are not available in this build.",
            }),
          );
        }
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not check for updates",
            description: error instanceof Error ? error.message : "Update check failed.",
          }),
        );
      });
  }, [updateState]);

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = { download: "Download", install: "Install" };
  const statusLabel: Record<string, string> = {
    checking: "Checking…",
    downloading: "Downloading…",
    "up-to-date": "Up to Date",
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? "Check for Updates";
  const description =
    action === "download" || action === "install"
      ? "Update available."
      : "Current version of the application.";

  return (
    <>
      <SettingsRow
        title={<AboutVersionTitle />}
        description={description}
        control={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant={action === "install" ? "default" : "outline"}
                  disabled={buttonDisabled}
                  onClick={handleButtonClick}
                >
                  {buttonLabel}
                </Button>
              }
            />
            {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
          </Tooltip>
        }
      />
      {hasDesktopBridge ? (
        <SettingsRow
          title="Update track"
          description="Stable follows full releases. Nightly follows the nightly desktop channel. GMACKO follows the custom GMACKO release lane."
          control={
            <Select
              value={selectedUpdateChannel}
              onValueChange={(value) => {
                handleUpdateChannelChange(value as DesktopUpdateChannel);
              }}
            >
              <SelectTrigger
                className="w-full sm:w-40"
                aria-label="Update track"
                disabled={isChangingUpdateChannel}
              >
                <SelectValue>{selectedUpdateChannelLabel}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {DESKTOP_UPDATE_CHANNEL_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      ) : selectedHostedAppChannel ? (
        <SettingsRow
          title="Update track"
          description="Switches the hosted app release channel."
          control={
            <Select
              value={selectedHostedAppChannel}
              onValueChange={(value) => {
                if (value === selectedHostedAppChannel) return;
                window.location.assign(
                  buildHostedChannelSelectionUrl({ channel: value as HostedAppChannel }),
                );
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Update track">
                <SelectValue>{HOSTED_APP_CHANNEL_LABEL}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  Latest
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  Nightly
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
    </>
  );
}

function formatTerminalShellArgs(shellArgs: ReadonlyArray<string>) {
  return shellArgs.join("\n");
}

function parseTerminalShellArgs(shellArgsText: string) {
  return shellArgsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function formatTerminalEnv(env: Record<string, string>) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function parseTerminalEnv(envText: string) {
  const env: Record<string, string> = {};
  const lines = envText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      return {
        env: null,
        error: "Environment variables must use KEY=VALUE format.",
      } as const;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return {
        env: null,
        error: "Environment variable names must start with a letter or underscore.",
      } as const;
    }

    env[key] = value;
  }

  return {
    env,
    error: null,
  } as const;
}

export function useSettingsRestore(onRestored?: () => void) {
  const {
    theme,
    setTheme,
    followSystem,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    themeHalves,
  } = useTheme();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const isBackgroundActivityDirty = hasChangedBackgroundActivitySettings(settings);

  const changedSettingLabels = useMemo(
    () => [
      ...(theme !== "system" ? ["Theme"] : []),
      ...(!followSystem ? ["Follow system"] : []),
      ...(themeHalves !== null ? ["Theme mix"] : []),
      ...(settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? ["Glass opacity"] : []),
      ...(settings.environmentIdentificationMode !==
      DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode
        ? ["Environment identification"]
        : []),
      ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
        ? ["Time format"]
        : []),
      ...(settings.sidebarThreadPreviewCount !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount
        ? ["Visible threads"]
        : []),
      ...(settings.sidebarProjectGroupingMode !==
      DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode
        ? ["Project Grouping"]
        : []),
      ...(settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap ? ["Word wrap"] : []),
      ...(settings.fontFamilySans !== DEFAULT_UNIFIED_SETTINGS.fontFamilySans
        ? ["Interface font"]
        : []),
      ...(settings.fontFamilyComposer !== DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer
        ? ["Prompt font"]
        : []),
      ...(settings.fontFamilyCode !== DEFAULT_UNIFIED_SETTINGS.fontFamilyCode ? ["Code font"] : []),
      ...(settings.fontFamilyTerminal !== DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal
        ? ["Terminal font"]
        : []),
      ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
        ? ["Diff whitespace changes"]
        : []),
      ...(settings.enableLegacyTokenStreaming !==
      DEFAULT_UNIFIED_SETTINGS.enableLegacyTokenStreaming
        ? ["Stream token by token"]
        : []),
      ...(settings.enableProviderUpdateChecks !==
      DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks
        ? ["Provider update checks"]
        : []),
      ...(isBackgroundActivityDirty ? ["Background activity"] : []),
      ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
        ? ["New thread mode"]
        : []),
      ...(settings.newWorktreesStartFromOrigin !==
      DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
        ? ["New worktrees start from origin"]
        : []),
      ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
        ? ["Add project base directory"]
        : []),
      ...(!Equal.equals(settings.terminal, DEFAULT_UNIFIED_SETTINGS.terminal) ? ["Terminal"] : []),
      ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
        ? ["Archive confirmation"]
        : []),
      ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
        ? ["Delete confirmation"]
        : []),
      ...(isTextGenerationModelDirty ? ["Text generation model"] : []),
    ],
    [
      isTextGenerationModelDirty,
      isBackgroundActivityDirty,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.addProjectBaseDirectory,
      settings.defaultThreadEnvMode,
      settings.newWorktreesStartFromOrigin,
      settings.diffIgnoreWhitespace,
      settings.environmentIdentificationMode,
      settings.fontFamilyCode,
      settings.fontFamilyComposer,
      settings.fontFamilySans,
      settings.fontFamilyTerminal,
      settings.fontSizeCode,
      settings.fontSizeInterface,
      settings.fontSizePrompt,
      settings.fontSizeTerminal,
      settings.glassOpacity,
      settings.enableLegacyTokenStreaming,
      settings.enableProviderUpdateChecks,
      settings.sidebarProjectGroupingMode,
      settings.sidebarThreadPreviewCount,
      settings.timestampFormat,
      settings.wordWrap,
      theme,
    ],
  );

  const restoreDefaults = useCallback(async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
    );
    if (!confirmed) return;

    // Only touch the theme keys that are actually dirty, so a theme-storage
    // failure cannot block restoring unrelated settings. Preferences are
    // re-read after the confirmation dialog: they may have changed (another
    // tab, an OS flip) while it was open, and rollback must restore the live
    // values rather than the ones captured at render time.
    let previousTheme = theme;
    try {
      previousTheme = readThemePreference();
    } catch {
      // Storage is unreadable; the render-time value is the best rollback.
    }
    // The mix may have changed while the confirmation dialog was open; both
    // the dirty check and the rollback must see the live value.
    const liveHalves = readThemeHalves();
    const needsThemeReset = previousTheme !== "system";
    const needsMixReset = liveHalves !== null;
    // Same for the appearance mode: trusting the render-time value would skip
    // the reset and report success while a non-system mode stayed in storage.
    const needsFollowSystemReset = readAppearanceModePreference(previousTheme) !== "system";
    const notifyThemeRestoreFailure = () => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn’t restore theme settings",
          description: "Try again.",
        }),
      );
    };
    // Rollback restores the base preference first (which clears any mix) and
    // then re-applies the captured mix on top, so no failure path can leave
    // the pair of keys half-restored.
    const previousHalves = liveHalves;
    const rollbackThemeState = () => {
      if (needsThemeReset) setTheme(previousTheme);
      if (previousHalves?.light) setThemeHalf("light", previousHalves.light);
      if (previousHalves?.dark) setThemeHalf("dark", previousHalves.dark);
    };
    if (needsThemeReset && !setTheme("system")) {
      notifyThemeRestoreFailure();
      return;
    }
    if (needsMixReset && !clearThemeHalves()) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    if (needsFollowSystemReset && !setFollowSystem(true)) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    updateSettings({
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      environmentIdentificationMode: DEFAULT_UNIFIED_SETTINGS.environmentIdentificationMode,
      glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
      sidebarThreadPreviewCount: DEFAULT_UNIFIED_SETTINGS.sidebarThreadPreviewCount,
      sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
      enableLegacyTokenStreaming: DEFAULT_UNIFIED_SETTINGS.enableLegacyTokenStreaming,
      enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
      backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
      backgroundActivityProfile: DEFAULT_UNIFIED_SETTINGS.backgroundActivityProfile,
      automaticGitFetchInterval: DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
      providerHealthRefreshInterval: DEFAULT_UNIFIED_SETTINGS.providerHealthRefreshInterval,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
      fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
      fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
      fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
      fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
    });
    onRestored?.();
  }, [
    changedSettingLabels,
    clearThemeHalves,
    onRestored,
    setFollowSystem,
    setTheme,
    setThemeHalf,
    theme,
    themeHalves,
    updateSettings,
  ]);

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

function BackgroundActivityAdvancedDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const resolvedBackgroundActivity = resolveServerBackgroundActivitySettings(settings);
  const activeProfile = resolvedBackgroundActivity.profile;
  const automaticGitFetchIntervalSeconds = durationToSeconds(
    resolvedBackgroundActivity.automaticGitFetchInterval,
  );
  const providerHealthRefreshIntervalSeconds = durationToSeconds(
    resolvedBackgroundActivity.providerHealthRefreshInterval,
  );
  const hostPowerMonitorActiveIntervalSeconds = durationToSeconds(
    resolvedBackgroundActivity.hostPowerMonitorActiveInterval,
  );
  const hostPowerMonitorIdleIntervalSeconds = durationToSeconds(
    resolvedBackgroundActivity.hostPowerMonitorIdleInterval,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Background Activity</DialogTitle>
          <DialogDescription>
            Tune the shared power policy and the background intervals that feed it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-0 px-6 pb-5">
          <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
            <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">Shared policy</div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Controls whether background work may run after a subscribed interval fires.
                </p>
              </div>
              <Select
                value={activeProfile}
                onValueChange={(value) => {
                  if (
                    value === "balanced" ||
                    value === "performance" ||
                    value === "battery-saver"
                  ) {
                    updateSettings({
                      backgroundActivity: backgroundActivitySharedPolicySettings(settings, value),
                    });
                  }
                }}
              >
                <SelectTrigger className="w-full sm:w-40" aria-label="Shared background policy">
                  <SelectValue>{BACKGROUND_ACTIVITY_PROFILE_LABELS[activeProfile]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="balanced">
                    {BACKGROUND_ACTIVITY_PROFILE_LABELS.balanced}
                  </SelectItem>
                  <SelectItem hideIndicator value="performance">
                    {BACKGROUND_ACTIVITY_PROFILE_LABELS.performance}
                  </SelectItem>
                  <SelectItem hideIndicator value="battery-saver">
                    {BACKGROUND_ACTIVITY_PROFILE_LABELS["battery-saver"]}
                  </SelectItem>
                </SelectPopup>
              </Select>
            </div>

            <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">Git fetch interval</div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Refresh remote branch status in the background.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NumberField
                  value={automaticGitFetchIntervalSeconds}
                  min={0}
                  step={5}
                  size="sm"
                  className="w-32"
                  onValueChange={(value) =>
                    updateSettings(
                      backgroundActivityOverrideSettings(
                        settings.backgroundActivity,
                        resolvedBackgroundActivity,
                        {
                          automaticGitFetchInterval: Duration.seconds(
                            normalizeIntervalSeconds(value),
                          ),
                        },
                      ),
                    )
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease Git fetch interval" />
                    <NumberFieldInput aria-label="Git fetch interval in seconds" />
                    <NumberFieldIncrement aria-label="Increase Git fetch interval" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">seconds</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">Provider health interval</div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Refresh provider availability, versions, auth state, and model metadata.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NumberField
                  value={providerHealthRefreshIntervalSeconds}
                  min={0}
                  step={PROVIDER_HEALTH_INTERVAL_STEP_SECONDS}
                  size="sm"
                  className="w-32"
                  onValueChange={(value) =>
                    updateSettings(
                      backgroundActivityOverrideSettings(
                        settings.backgroundActivity,
                        resolvedBackgroundActivity,
                        {
                          providerHealthRefreshInterval: Duration.seconds(
                            normalizeIntervalSeconds(value),
                          ),
                        },
                      ),
                    )
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease provider health interval" />
                    <NumberFieldInput aria-label="Provider health interval in seconds" />
                    <NumberFieldIncrement aria-label="Increase provider health interval" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">seconds</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">Host power monitor</div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Poll host power state while clients are active.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NumberField
                  value={hostPowerMonitorActiveIntervalSeconds}
                  min={5}
                  step={5}
                  size="sm"
                  className="w-32"
                  onValueChange={(value) =>
                    updateSettings(
                      backgroundActivityOverrideSettings(
                        settings.backgroundActivity,
                        resolvedBackgroundActivity,
                        {
                          hostPowerMonitorActiveInterval: Duration.seconds(
                            normalizeIntervalSeconds(value, 5),
                          ),
                        },
                      ),
                    )
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease active host power interval" />
                    <NumberFieldInput aria-label="Active host power interval in seconds" />
                    <NumberFieldIncrement aria-label="Increase active host power interval" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">seconds</span>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="text-sm font-medium">Idle host monitor</div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Poll host power state when no foreground client is active.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <NumberField
                  value={hostPowerMonitorIdleIntervalSeconds}
                  min={5}
                  step={30}
                  size="sm"
                  className="w-32"
                  onValueChange={(value) =>
                    updateSettings(
                      backgroundActivityOverrideSettings(
                        settings.backgroundActivity,
                        resolvedBackgroundActivity,
                        {
                          hostPowerMonitorIdleInterval: Duration.seconds(
                            normalizeIntervalSeconds(value, 5),
                          ),
                        },
                      ),
                    )
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease idle host power interval" />
                    <NumberFieldInput aria-label="Idle host power interval in seconds" />
                    <NumberFieldIncrement aria-label="Increase idle host power interval" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">seconds</span>
              </div>
            </div>

            <div className="grid gap-0 border-t sm:grid-cols-2">
              {BACKGROUND_ACTIVITY_BOOLEAN_OVERRIDES.map(({ key, label }) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-3 border-b px-4 py-3 last:border-b-0 sm:border-r sm:even:border-r-0"
                >
                  <span className="text-sm font-medium">{label}</span>
                  <Switch
                    checked={resolvedBackgroundActivity[key]}
                    onCheckedChange={(checked) =>
                      updateSettings(
                        backgroundActivityOverrideSettings(
                          settings.backgroundActivity,
                          resolvedBackgroundActivity,
                          {
                            [key]: Boolean(checked),
                          },
                        ),
                      )
                    }
                    aria-label={label}
                  />
                </label>
              ))}
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => updateSettings(resetBackgroundActivitySettings())}
          >
            Reset all
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

export function AppearanceSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const environmentStageLabel = useEnvironmentStageLabel();
  const showEnvironmentIdentification =
    resolveEnvironmentIdentificationPillLabel(environmentStageLabel) !== null;
  const glassOpacityRatio =
    (settings.glassOpacity - MIN_GLASS_OPACITY) / (MAX_GLASS_OPACITY - MIN_GLASS_OPACITY);
  const glassOpacitySliderStyle = {
    "--glass-slider-progress": `${glassOpacityRatio * 100}%`,
    "--glass-slider-fill-offset": `${0.5 - glassOpacityRatio}rem`,
  } as CSSProperties;

  return (
    <SettingsPageContainer>
      <SettingsSection id="appearance" title="Appearance">
        <SettingsRow
          {...searchableSetting("theme")}
          description="Choose how T3 Code looks across the app."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="theme" onClick={() => setTheme("system")} />
            ) : null
          }
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") {
                  setTheme(value);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          {...searchableSetting("setting-glass-opacity")}
          description="Control how transparent glass surfaces are. Higher values make menus, dialogs, and the composer more solid."
          resetAction={
            settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? (
              <SettingResetButton
                label="glass opacity"
                onClick={() =>
                  updateSettings({ glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity })
                }
              />
            ) : null
          }
          control={
            <div className="flex w-full items-center gap-3 sm:w-52">
              <output
                className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
                htmlFor="glass-opacity"
              >
                {settings.glassOpacity}%
              </output>
              <input
                aria-label="Glass opacity"
                className="glass-opacity-slider min-w-0 flex-1"
                id="glass-opacity"
                max={MAX_GLASS_OPACITY}
                min={MIN_GLASS_OPACITY}
                onChange={(event) => {
                  const glassOpacity = Number(event.currentTarget.value);
                  if (
                    Number.isInteger(glassOpacity) &&
                    glassOpacity >= MIN_GLASS_OPACITY &&
                    glassOpacity <= MAX_GLASS_OPACITY
                  ) {
                    updateSettings({ glassOpacity });
                  }
                }}
                step={5}
                style={glassOpacitySliderStyle}
                type="range"
                value={settings.glassOpacity}
              />
            </div>
          }
        />

        {showEnvironmentIdentification ? (
          <SettingsRow
            {...searchableSetting("environment-identification")}
            description="Choose how Dev, Nightly, and GMACKO environments are identified."
            resetAction={
              settings.environmentIdentificationMode !== DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE ? (
                <SettingResetButton
                  label="environment identification"
                  onClick={() =>
                    updateSettings({
                      environmentIdentificationMode: DEFAULT_ENVIRONMENT_IDENTIFICATION_MODE,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.environmentIdentificationMode}
                onValueChange={(value) => {
                  if (value === "artwork" || value === "pill" || value === "none") {
                    updateSettings({ environmentIdentificationMode: value });
                  }
                }}
              >
                <SelectTrigger className="w-full sm:w-40" aria-label="Environment identification">
                  <SelectValue>
                    {ENVIRONMENT_IDENTIFICATION_LABELS[settings.environmentIdentificationMode]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {Object.entries(ENVIRONMENT_IDENTIFICATION_LABELS).map(([value, label]) => (
                    <SelectItem hideIndicator key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}

        <SettingsRow
          {...searchableSetting("word-wrap")}
          description="Wrap long lines in code blocks, tables, diffs, and file previews by default."
          resetAction={
            settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap ? (
              <SettingResetButton
                label="word wrapping"
                onClick={() =>
                  updateSettings({
                    wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.wordWrap}
              onCheckedChange={(checked) => updateSettings({ wordWrap: Boolean(checked) })}
              aria-label="Wrap code, tables, diffs, and file previews by default"
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function TerminalSettingsPanel() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const terminalSettings = settings.terminal;
  const primaryEnvironment = usePrimaryEnvironment();
  const serverConfigs = useServerConfigs();
  const serverConfig = primaryEnvironment
    ? serverConfigs.get(primaryEnvironment.environmentId)
    : undefined;
  const currentShell = serverConfig?.terminal?.currentShell ?? "";
  const [terminalShellArgsDraft, setTerminalShellArgsDraft] = useState(() =>
    formatTerminalShellArgs(terminalSettings.profile.shellArgs),
  );
  const [terminalEnvDraft, setTerminalEnvDraft] = useState(() =>
    formatTerminalEnv(terminalSettings.profile.env),
  );
  const [terminalEnvError, setTerminalEnvError] = useState<string | null>(null);

  const updateTerminalProfile = useCallback(
    (
      patch: Partial<{
        shellPath: string;
        shellArgs: ReadonlyArray<string>;
        env: Record<string, string>;
      }>,
    ) => {
      updateSettings({
        terminal: {
          ...terminalSettings,
          profile: {
            ...terminalSettings.profile,
            ...patch,
          },
        },
      });
    },
    [terminalSettings, updateSettings],
  );

  useEffect(() => {
    setTerminalShellArgsDraft((currentDraft) =>
      Equal.equals(parseTerminalShellArgs(currentDraft), terminalSettings.profile.shellArgs)
        ? currentDraft
        : formatTerminalShellArgs(terminalSettings.profile.shellArgs),
    );
  }, [terminalSettings.profile.shellArgs]);

  useEffect(() => {
    setTerminalEnvDraft((currentDraft) => {
      const parsedDraft = parseTerminalEnv(currentDraft);
      if (
        parsedDraft.error === null &&
        Equal.equals(parsedDraft.env, terminalSettings.profile.env)
      ) {
        return currentDraft;
      }
      return formatTerminalEnv(terminalSettings.profile.env);
    });
    setTerminalEnvError(null);
  }, [terminalSettings.profile.env]);

  return (
    <SettingsPageContainer>
      <SettingsSection title="Terminal">
        <SettingsRow
          title="Environment variables"
          description="One KEY=value per line. These are merged into every terminal before project/worktree variables are added."
          resetAction={
            terminalSettings.environmentVariablesText !==
            DEFAULT_UNIFIED_SETTINGS.terminal.environmentVariablesText ? (
              <SettingResetButton
                label="terminal environment variables"
                onClick={() =>
                  updateSettings({
                    terminal: {
                      ...terminalSettings,
                      environmentVariablesText:
                        DEFAULT_UNIFIED_SETTINGS.terminal.environmentVariablesText,
                    },
                  })
                }
              />
            ) : null
          }
          control={
            <Textarea
              className="min-h-28 w-full font-mono text-xs sm:w-96"
              value={terminalSettings.environmentVariablesText}
              onChange={(event) =>
                updateSettings({
                  terminal: {
                    ...terminalSettings,
                    environmentVariablesText: event.target.value,
                  },
                })
              }
              placeholder={"T3_SANDBOX=1\nFEATURE_FLAG=true"}
              spellCheck={false}
              aria-label="Terminal environment variables"
            />
          }
        />

        <SettingsRow
          title="Zsh startup directory"
          description='Sets ZDOTDIR for integrated terminals. Point this at a directory containing a separate ".zshrc".'
          resetAction={
            terminalSettings.zshStartupDirectory !==
            DEFAULT_UNIFIED_SETTINGS.terminal.zshStartupDirectory ? (
              <SettingResetButton
                label="zsh startup directory"
                onClick={() =>
                  updateSettings({
                    terminal: {
                      ...terminalSettings,
                      zshStartupDirectory: DEFAULT_UNIFIED_SETTINGS.terminal.zshStartupDirectory,
                    },
                  })
                }
              />
            ) : null
          }
          control={
            <Input
              className="w-full sm:w-96"
              value={terminalSettings.zshStartupDirectory}
              onChange={(event) =>
                updateSettings({
                  terminal: {
                    ...terminalSettings,
                    zshStartupDirectory: event.target.value,
                  },
                })
              }
              placeholder="~/.config/t3code/zsh"
              spellCheck={false}
              aria-label="Zsh startup directory"
            />
          }
        />

        <SettingsRow
          title="Shell executable override"
          description="Optional absolute path for a different shell."
          resetAction={
            terminalSettings.profile.shellPath !==
            DEFAULT_UNIFIED_SETTINGS.terminal.profile.shellPath ? (
              <SettingResetButton
                label="terminal shell path"
                onClick={() =>
                  updateTerminalProfile({
                    shellPath: DEFAULT_UNIFIED_SETTINGS.terminal.profile.shellPath,
                  })
                }
              />
            ) : null
          }
          control={
            <Input
              className="w-full sm:w-96"
              value={terminalSettings.profile.shellPath}
              onChange={(event) => updateTerminalProfile({ shellPath: event.target.value })}
              placeholder={currentShell}
              spellCheck={false}
              aria-label="Terminal shell path"
            />
          }
        />

        <SettingsRow
          title="Shell arguments"
          description="Optional startup arguments for the terminal shell. Enter one argument per line."
          resetAction={
            !Equal.equals(
              terminalSettings.profile.shellArgs,
              DEFAULT_UNIFIED_SETTINGS.terminal.profile.shellArgs,
            ) ? (
              <SettingResetButton
                label="terminal shell arguments"
                onClick={() =>
                  updateTerminalProfile({
                    shellArgs: DEFAULT_UNIFIED_SETTINGS.terminal.profile.shellArgs,
                  })
                }
              />
            ) : null
          }
          control={
            <Textarea
              className="min-h-24 w-full font-mono text-xs sm:w-96"
              value={terminalShellArgsDraft}
              onChange={(event) => {
                const nextValue = event.target.value;
                setTerminalShellArgsDraft(nextValue);
                updateTerminalProfile({ shellArgs: parseTerminalShellArgs(nextValue) });
              }}
              placeholder={"-l\n--norc"}
              spellCheck={false}
              aria-label="Terminal shell arguments"
            />
          }
        />

        <SettingsRow
          title="Profile environment"
          description="Environment variables passed directly to the terminal profile. One KEY=value per line."
          resetAction={
            !Equal.equals(
              terminalSettings.profile.env,
              DEFAULT_UNIFIED_SETTINGS.terminal.profile.env,
            ) ? (
              <SettingResetButton
                label="terminal profile environment variables"
                onClick={() =>
                  updateTerminalProfile({
                    env: DEFAULT_UNIFIED_SETTINGS.terminal.profile.env,
                  })
                }
              />
            ) : null
          }
          status={
            terminalEnvError ? <span className="text-destructive">{terminalEnvError}</span> : null
          }
          control={
            <Textarea
              className="min-h-28 w-full font-mono text-xs sm:w-96"
              value={terminalEnvDraft}
              onChange={(event) => {
                const nextValue = event.target.value;
                setTerminalEnvDraft(nextValue);
                const parsed = parseTerminalEnv(nextValue);
                setTerminalEnvError(parsed.error);
                if (parsed.error !== null) {
                  return;
                }

                updateTerminalProfile({ env: parsed.env });
              }}
              placeholder={"TERM_PROGRAM=T3Code\nTERM=xterm-256color"}
              spellCheck={false}
              aria-label="Terminal profile environment variables"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="How it works">
        <SettingsRow
          title={
            <span className="inline-flex items-center gap-2">
              <TerminalIcon className="size-4 text-muted-foreground" />
              Terminal startup
            </span>
          }
          description="T3 Code passes these values through the existing terminal env override path, so regular terminals, script terminals, and worktree terminals share the same base environment."
          control={null}
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function LegacyFeaturesSection() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();

  return (
    <SettingsSection title="Legacy features">
      <SettingsRow
        {...searchableSetting("legacy-token-streaming")}
        description="Paint assistant output token by token instead of in complete chunks. This compatibility mode is slower than buffered output."
        control={
          <Switch
            checked={settings.enableLegacyTokenStreaming}
            onCheckedChange={(checked) =>
              updateSettings({ enableLegacyTokenStreaming: Boolean(checked) })
            }
            aria-label="Stream token by token (legacy)"
          />
        }
      />
    </SettingsSection>
  );
}

export function GeneralSettingsPanel() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const [backgroundActivityDialogOpen, setBackgroundActivityDialogOpen] = useState(false);
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(
    readLastEnabledProjectGroupingMode(),
  );
  const observability = useAtomValue(primaryServerObservabilityAtom);
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const diagnosticsDescription = formatDiagnosticsDescription({
    localTracingEnabled: observability?.localTracingEnabled ?? false,
    otlpTracesEnabled: observability?.otlpTracesEnabled ?? false,
    otlpTracesUrl: observability?.otlpTracesUrl,
    otlpMetricsEnabled: observability?.otlpMetricsEnabled ?? false,
    otlpMetricsUrl: observability?.otlpMetricsUrl,
  });

  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const textGenerationModelInstanceEntries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
  );
  const textGenInstanceEntry = textGenerationModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const textGenerationModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const resolvedBackgroundActivity = resolveServerBackgroundActivitySettings(settings);
  const activeBackgroundActivityProfile = resolvedBackgroundActivity.profile;
  const backgroundActivityProfileOption = resolveBackgroundActivityProfileOption(settings);
  const backgroundActivityDescription =
    backgroundActivityProfileOption === "advanced"
      ? `${ADVANCED_BACKGROUND_ACTIVITY_DESCRIPTION} Current shared policy: ${
          BACKGROUND_ACTIVITY_PROFILE_LABELS[activeBackgroundActivityProfile]
        }.`
      : BACKGROUND_ACTIVITY_PROFILE_DESCRIPTIONS[resolvedBackgroundActivity.profile];
  const canResetBackgroundActivity = !Equal.equals(
    settings.backgroundActivity,
    DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="General">
        <SettingsRow
          {...searchableSetting("project-grouping")}
          description="Combine matching repositories across environments."
          resetAction={
            settings.sidebarProjectGroupingMode !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode ? (
              <SettingResetButton
                label="project grouping"
                onClick={() =>
                  updateSettings({
                    sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={isProjectGroupingEnabled(settings.sidebarProjectGroupingMode)}
              onCheckedChange={(checked) => {
                if (!checked && settings.sidebarProjectGroupingMode !== "separate") {
                  lastEnabledProjectGroupingMode.current = settings.sidebarProjectGroupingMode;
                  rememberEnabledProjectGroupingMode(settings.sidebarProjectGroupingMode);
                }
                updateSettings({
                  sidebarProjectGroupingMode: projectGroupingModeFromToggle(
                    checked,
                    lastEnabledProjectGroupingMode.current,
                  ),
                });
              }}
              aria-label="Project grouping"
            />
          }
        />

        <SettingsRow
          {...searchableSetting("time-format")}
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-40" aria-label="Timestamp format">
                <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {TIMESTAMP_FORMAT_LABELS.locale}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {TIMESTAMP_FORMAT_LABELS["12-hour"]}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {TIMESTAMP_FORMAT_LABELS["24-hour"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        <SettingsRow
          {...searchableSetting("hide-whitespace-changes")}
          description="Set whether the diff panel ignores whitespace-only edits by default."
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                label="diff whitespace changes"
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label="Hide whitespace changes by default"
            />
          }
        />

        <SettingsRow
          {...searchableSetting("provider-update-checks")}
          description="Check installed provider CLIs for newer available versions."
          resetAction={
            settings.enableProviderUpdateChecks !==
            DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks ? (
              <SettingResetButton
                label="provider update checks"
                onClick={() =>
                  updateSettings({
                    enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableProviderUpdateChecks}
              onCheckedChange={(checked) =>
                updateSettings({ enableProviderUpdateChecks: Boolean(checked) })
              }
              aria-label="Check provider versions"
            />
          }
        />

        <SettingsRow
          title={
            <span className="inline-flex items-center gap-1.5">
              Background activity
              <PolicyTooltip>
                This shared policy gates background work such as Git refreshes and provider health
                probes after their individual intervals elapse.
              </PolicyTooltip>
            </span>
          }
          description={backgroundActivityDescription}
          resetAction={
            canResetBackgroundActivity ? (
              <SettingResetButton
                label="background activity"
                onClick={() => updateSettings(resetBackgroundActivitySettings())}
              />
            ) : null
          }
          control={
            <>
              <Select
                value={backgroundActivityProfileOption}
                onValueChange={(value) => {
                  if (value === "advanced") {
                    setBackgroundActivityDialogOpen(true);
                    return;
                  }
                  if (
                    value === "balanced" ||
                    value === "performance" ||
                    value === "battery-saver"
                  ) {
                    updateSettings(backgroundActivityProfileSettings(value));
                  }
                }}
              >
                <SelectTrigger className="w-full sm:w-40" aria-label="Background activity profile">
                  <SelectValue>
                    {BACKGROUND_ACTIVITY_PROFILE_OPTION_LABELS[backgroundActivityProfileOption]}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="balanced">
                    {BACKGROUND_ACTIVITY_PROFILE_LABELS.balanced}
                  </SelectItem>
                  <SelectItem hideIndicator value="performance">
                    {BACKGROUND_ACTIVITY_PROFILE_LABELS.performance}
                  </SelectItem>
                  <SelectItem hideIndicator value="battery-saver">
                    {BACKGROUND_ACTIVITY_PROFILE_LABELS["battery-saver"]}
                  </SelectItem>
                  <SelectItem hideIndicator value="advanced">
                    {BACKGROUND_ACTIVITY_PROFILE_OPTION_LABELS.advanced}
                  </SelectItem>
                </SelectPopup>
              </Select>
              {backgroundActivityProfileOption === "advanced" ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="outline"
                        aria-label="Configure advanced background activity"
                        onClick={() => setBackgroundActivityDialogOpen(true)}
                      >
                        <SettingsIcon className="size-4" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="top">Configure background activity</TooltipPopup>
                </Tooltip>
              ) : null}
              <BackgroundActivityAdvancedDialog
                open={backgroundActivityDialogOpen}
                onOpenChange={setBackgroundActivityDialogOpen}
              />
            </>
          }
        />

        <SettingsRow
          {...searchableSetting("new-threads")}
          description="Pick the default workspace mode for newly created draft threads."
          resetAction={
            settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode ||
            settings.newWorktreesStartFromOrigin !==
              DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
              <SettingResetButton
                label="new threads"
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
                    newWorktreesStartFromOrigin:
                      DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value === "local" || value === "worktree") {
                  updateSettings({ defaultThreadEnvMode: value });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-44" aria-label="Default thread mode">
                <SelectValue>
                  {settings.defaultThreadEnvMode === "worktree" ? "New worktree" : "Local"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="local">
                  Local
                </SelectItem>
                <SelectItem hideIndicator value="worktree">
                  New worktree
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />

        {settings.defaultThreadEnvMode === "worktree" ? (
          <SettingsRow
            className="bg-muted/20 sm:pl-9"
            title={searchableSetting("start-from-origin").title}
            description="Creates the worktree from the latest matching branch on origin instead of your local branch."
            resetAction={
              settings.newWorktreesStartFromOrigin !==
              DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin ? (
                <SettingResetButton
                  label="new worktrees start from origin"
                  onClick={() =>
                    updateSettings({
                      newWorktreesStartFromOrigin:
                        DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                checked={settings.newWorktreesStartFromOrigin}
                onCheckedChange={(checked) =>
                  updateSettings({ newWorktreesStartFromOrigin: Boolean(checked) })
                }
                aria-label="Start new worktrees from origin by default"
              />
            }
          />
        ) : null}

        <SettingsRow
          {...searchableSetting("add-project-starts-in")}
          description='Leave empty to use "~/" when the Add Project browser opens.'
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                label="add project base directory"
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              className="w-full sm:w-72"
              value={settings.addProjectBaseDirectory}
              onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
              placeholder="~/"
              spellCheck={false}
              aria-label="Add project base directory"
            />
          }
        />

        <SettingsRow
          {...searchableSetting("archive-confirmation")}
          description="Require a second click on the inline archive action before a thread is archived."
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label="archive confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label="Confirm thread archiving"
            />
          }
        />

        <SettingsRow
          {...searchableSetting("delete-confirmation")}
          description="Ask before deleting a thread and its chat history."
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label="delete confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label="Confirm thread deletion"
            />
          }
        />

        <SettingsRow
          {...searchableSetting("text-generation-model")}
          description="Default model for generated text like thread titles and source control content. Source control settings can override it with a dedicated source control writer model."
          resetAction={
            isTextGenerationModelDirty ? (
              <SettingResetButton
                label="text generation model"
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                activeInstanceId={textGenInstanceId}
                model={textGenModel}
                lockedProvider={null}
                instanceEntries={textGenerationModelInstanceEntries}
                modelOptionsByInstance={textGenerationModelOptionsByInstance}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onInstanceModelChange={(instanceId, model) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(instanceId, model),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={textGenProvider}
                models={
                  // Use the exact instance's models (rather than the
                  // first-kind-match) so a custom text-gen instance like
                  // `codex_personal` gets its own model list, not the
                  // default Codex one.
                  textGenInstanceEntry?.models ?? []
                }
                model={textGenModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={textGenModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(
                          textGenInstanceId,
                          textGenModel,
                          nextOptions,
                        ),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection title="About">
        {isElectron || HOSTED_APP_CHANNEL ? (
          <AboutVersionSection />
        ) : (
          <SettingsRow
            title={<AboutVersionTitle />}
            description="Current version of the application."
          />
        )}
        <SettingsRow
          {...searchableSetting("diagnostics")}
          description={diagnosticsDescription}
          control={
            <Button render={<Link to="/settings/diagnostics" />} size="xs" variant="outline">
              View diagnostics
            </Button>
          }
        />
      </SettingsSection>

      <LegacyFeaturesSection />
    </SettingsPageContainer>
  );
}

export function ArchivedThreadsPanel() {
  const projects = useProjects();
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const environmentIds = useMemo(
    () => [...new Set(projects.map((project) => project.environmentId))],
    [projects],
  );
  const {
    snapshots: archivedSnapshots,
    error: archiveError,
    isLoading: isLoadingArchive,
    refresh: refreshArchivedThreads,
  } = useArchivedThreadSnapshots(environmentIds);

  const archivedGroups = useMemo(() => {
    const projectsByEnvironmentAndId = new Map(
      archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
        snapshot.projects.map(
          (project) =>
            [
              `${environmentId}:${project.id}`,
              {
                id: project.id,
                environmentId,
                name: project.title,
                cwd: project.workspaceRoot,
              },
            ] as const,
        ),
      ),
    );
    const threads = archivedSnapshots.flatMap(({ environmentId, snapshot }) =>
      snapshot.threads.map((thread) => ({
        ...thread,
        environmentId,
      })),
    );

    const archivedProjects = Array.from(projectsByEnvironmentAndId.values());
    const groups: Array<{
      readonly project: (typeof archivedProjects)[number];
      readonly threads: Array<(typeof threads)[number]>;
    }> = [];
    for (const project of archivedProjects) {
      const projectThreads: Array<(typeof threads)[number]> = [];
      for (const thread of threads) {
        if (thread.projectId === project.id && thread.environmentId === project.environmentId) {
          projectThreads.push(thread);
        }
      }
      if (projectThreads.length > 0) {
        groups.push({
          project,
          threads: projectThreads.toSorted((left, right) => {
            const leftKey = left.archivedAt ?? left.createdAt;
            const rightKey = right.archivedAt ?? right.createdAt;
            return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
          }),
        });
      }
    }
    return groups;
  }, [archivedSnapshots]);

  const handleArchivedThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "unarchive", label: "Unarchive" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "unarchive") {
        const result = await unarchiveThread(threadRef);
        if (result._tag === "Success") {
          refreshArchivedThreads();
        } else if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to unarchive thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
        return;
      }

      if (clicked === "delete") {
        const result = await confirmAndDeleteThread(threadRef);
        if (result._tag === "Success") {
          refreshArchivedThreads();
        } else if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to delete thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      }
    },
    [confirmAndDeleteThread, refreshArchivedThreads, unarchiveThread],
  );

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection
          id={isLoadingArchive ? undefined : searchableSetting("archive").id}
          title={searchableSetting("archive").title}
        >
          <SettingsRow
            title={
              <span className="inline-flex items-center gap-2">
                {isLoadingArchive ? (
                  <LoaderIcon className="size-3.5 animate-spin text-muted-foreground" />
                ) : (
                  <ArchiveIcon className="size-3.5 text-muted-foreground" />
                )}
                {isLoadingArchive
                  ? "Loading archived threads"
                  : archiveError
                    ? "Could not load archived threads"
                    : "No archived threads"}
              </span>
            }
            description={
              isLoadingArchive
                ? "Checking connected environments."
                : (archiveError ?? "Archived threads will appear here.")
            }
          />
        </SettingsSection>
      ) : (
        archivedGroups.map(({ project, threads: projectThreads }, index) => (
          <SettingsSection
            key={project.id}
            id={index === 0 ? searchableSetting("archive").id : undefined}
            title={project.name}
            icon={<ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />}
          >
            {projectThreads.map((thread) => (
              <SettingsRow
                key={thread.id}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void (async () => {
                    const result = await settlePromise(() =>
                      handleArchivedThreadContextMenu(
                        scopeThreadRef(thread.environmentId, thread.id),
                        {
                          x: event.clientX,
                          y: event.clientY,
                        },
                      ),
                    );
                    if (result._tag === "Failure") {
                      const error = squashAtomCommandFailure(result);
                      toastManager.add(
                        stackedThreadToast({
                          type: "error",
                          title: "Archived thread action failed",
                          description:
                            error instanceof Error ? error.message : "An error occurred.",
                        }),
                      );
                    }
                  })();
                }}
                title={thread.title}
                description={
                  <>
                    Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}
                    {" \u00b7 Created "}
                    {formatRelativeTimeLabel(thread.createdAt)}
                  </>
                }
                control={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
                    onClick={() => {
                      void (async () => {
                        const result = await unarchiveThread(
                          scopeThreadRef(thread.environmentId, thread.id),
                        );
                        if (result._tag === "Success") {
                          refreshArchivedThreads();
                          return;
                        }
                        if (!isAtomCommandInterrupted(result)) {
                          const error = squashAtomCommandFailure(result);
                          toastManager.add(
                            stackedThreadToast({
                              type: "error",
                              title: "Failed to unarchive thread",
                              description:
                                error instanceof Error ? error.message : "An error occurred.",
                            }),
                          );
                        }
                      })();
                    }}
                  >
                    <ArchiveX className="size-3.5" />
                    <span>Unarchive</span>
                  </Button>
                }
              />
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
