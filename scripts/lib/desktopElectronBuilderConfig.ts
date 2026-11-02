// @effect-diagnostics nodeBuiltinImport:off - Build-time config runs under Node outside the Effect runtime.
import * as NodePath from "node:path";

import gnomeCaptureBundle from "../../apps/desktop/gnome-extension/bundle.json" with { type: "json" };
import { getDesktopRuntimeIdentity } from "../../apps/desktop/src/appIdentity.js";

/** What electron-builder packages for each desktop platform, and the config it is given. */
export type DesktopBuildPlatform = "mac" | "linux" | "win";
export type DesktopBuildArch = "arm64" | "x64" | "universal";

export interface GitHubPublishConfig {
  readonly provider: "github";
  readonly owner: string;
  readonly repo: string;
  readonly releaseType: "release" | "prerelease";
  readonly channel?: string;
  readonly updaterCacheDirName?: string;
}

export const DESKTOP_ELECTRON_LANGUAGES = ["en-US"] as const;
export const DESKTOP_FILE_EXCLUSIONS = [
  // Cursor walks from argv[1] to platform assets; helpers and native addons need real paths outside ASAR.
  "!**/node_modules/@cursor/sdk-*/**/*",
  "!apps/desktop/prod-resources/cursor-sdk",
  "!apps/desktop/prod-resources/cursor-sdk/**/*",
  // The installed Claude CLI is supplied explicitly; exclude optional bundled executables, retaining SDK JavaScript.
  "!**/node_modules/@anthropic-ai/claude-agent-sdk-*/**/*",
  "!**/*.map",
  "!**/*.d.cts",
  "!apps/desktop/resources/browser-secret",
  "!apps/desktop/resources/browser-secret/**/*",
  "!apps/desktop/prod-resources/browser-secret",
  "!apps/desktop/prod-resources/browser-secret/**/*",
  "!apps/desktop/prod-resources/windows-server",
  "!apps/desktop/prod-resources/windows-server/**/*",
  "!apps/desktop/prod-resources/wsl-runtime.tar.gz",
  "!apps/desktop/prod-resources/wsl-runtime.tar.gz.sha256",
  "!apps/desktop/gnome-extension",
  "!apps/desktop/gnome-extension/**/*",
] as const;
// Windows terminal helpers cannot run on macOS and slow signing and notarization.
export const MAC_FILE_EXCLUSIONS = [
  "!**/node_modules/node-pty/prebuilds/win32-*/**/*",
  "!**/node_modules/node-pty/third_party/conpty/**/*",
] as const;
// Linux builds node-pty from source; its prebuilds target other platforms.
export const LINUX_FILE_EXCLUSIONS = [
  ...MAC_FILE_EXCLUSIONS,
  "!**/node_modules/node-pty/prebuilds/darwin-*/**/*",
] as const;

// node-pty bundles both Darwin architectures; only universal apps need both.
export function resolveMacFileExclusions(arch?: DesktopBuildArch) {
  if (arch === undefined || arch === "universal") {
    return [...MAC_FILE_EXCLUSIONS];
  }

  const unusedArch = arch === "arm64" ? "x64" : "arm64";
  return [...MAC_FILE_EXCLUSIONS, `!**/node_modules/node-pty/prebuilds/darwin-${unusedArch}/**/*`];
}
// Large ASAR sidecars avoid NSIS extracting thousands of loose files during installs and updates.
export const WINDOWS_SERVER_ASAR_RESOURCE = "server.asar";
// Native modules and executables need real paths, so place them in ASAR's .unpacked sibling.
export const WINDOWS_NATIVE_ASAR_UNPACK_GLOB =
  "{**/*.node,**/*.dll,**/*.exe,**/*.so,**/*.so.*,**/*.dylib}";
export const WINDOWS_SERVER_ASAR_UNPACK_GLOBS = [
  "**/*.dll",
  "**/*.exe",
  "**/*.so",
  "**/*.so.*",
  "**/*.dylib",
] as const;
// Keep sidecar exclusions aligned with the app; .bin symlinks are unused and unsupported by ASAR extraction.
export const WINDOWS_SERVER_ASAR_IGNORE_GLOBS = [
  "**/node_modules/@cursor/sdk-*",
  "**/node_modules/@cursor/sdk-*/**",
  "**/node_modules/@anthropic-ai/claude-agent-sdk-*",
  "**/node_modules/@anthropic-ai/claude-agent-sdk-*/**",
  "**/node_modules/.bin",
  "**/node_modules/.bin/**",
  "**/*.map",
] as const;

export function resolveWindowsServerAsarIgnoreGlobs(arch: DesktopBuildArch) {
  const unusedArch = arch === "arm64" ? "x64" : "arm64";
  const unusedPrebuild = `**/node_modules/node-pty/prebuilds/win32-${unusedArch}`;
  const unusedConpty = `**/node_modules/node-pty/third_party/conpty/*/win10-${unusedArch}`;

  return [
    ...WINDOWS_SERVER_ASAR_IGNORE_GLOBS,
    unusedPrebuild,
    `${unusedPrebuild}/**`,
    unusedConpty,
    `${unusedConpty}/**`,
  ];
}

export const WINDOWS_PACKAGED_PAYLOAD_FILE_LIMIT = 80;
export const WINDOWS_SERVER_RESOURCE_SOURCE_DIR = "apps/desktop/prod-resources/windows-server";
export const WINDOWS_SERVER_EXTRA_RESOURCES = [
  {
    from: WINDOWS_SERVER_RESOURCE_SOURCE_DIR,
    to: ".",
    filter: [WINDOWS_SERVER_ASAR_RESOURCE, `${WINDOWS_SERVER_ASAR_RESOURCE}.unpacked/**/*`],
  },
] as const;
export const WSL_RUNTIME_ARCHIVE_NAME = "wsl-runtime.tar.gz";
export const WSL_RUNTIME_ARCHIVE_HASH_NAME = `${WSL_RUNTIME_ARCHIVE_NAME}.sha256`;
export const WSL_RUNTIME_ARCHIVE_EXTRA_RESOURCE = {
  from: `apps/desktop/prod-resources/${WSL_RUNTIME_ARCHIVE_NAME}`,
  to: WSL_RUNTIME_ARCHIVE_NAME,
} as const;
export const WSL_RUNTIME_ARCHIVE_HASH_EXTRA_RESOURCE = {
  from: `apps/desktop/prod-resources/${WSL_RUNTIME_ARCHIVE_HASH_NAME}`,
  to: WSL_RUNTIME_ARCHIVE_HASH_NAME,
} as const;

export const bundlesWslRuntime = (input: {
  readonly platform: DesktopBuildPlatform;
  readonly runtimeArchivePath: string | undefined;
}): boolean => input.platform === "win" && input.runtimeArchivePath !== undefined;

export const WSL_RUNTIME_EXTRA_RESOURCES = [
  WSL_RUNTIME_ARCHIVE_EXTRA_RESOURCE,
  WSL_RUNTIME_ARCHIVE_HASH_EXTRA_RESOURCE,
] as const;
export const DESKTOP_EXTRA_RESOURCES = [
  {
    from: "apps/desktop/prod-resources/cursor-sdk",
    to: "node_modules/@cursor",
  },
  {
    from: "apps/desktop/prod-resources/resource-monitor",
    to: "resource-monitor",
  },
  {
    from: "apps/desktop/prod-resources/plugins",
    to: "plugins",
  },
] as const;
export const LINUX_CAPTURE_EXTRA_RESOURCES = [
  {
    from: "apps/desktop/prod-resources/hyprland-capture",
    to: "hyprland-capture",
  },
  {
    from: "apps/desktop/prod-resources/kde-capture",
    to: "kde-capture",
  },
  {
    from: "apps/desktop/gnome-extension",
    to: "gnome-extension",
    filter: gnomeCaptureBundle.files,
  },
] as const;
export const LINUX_BROWSER_SECRET_EXTRA_RESOURCES = [
  { from: "apps/desktop/prod-resources/browser-secret", to: "browser-secret" },
] as const;

interface CreateDesktopElectronBuilderConfigInput {
  readonly platform: DesktopBuildPlatform;
  readonly target: string;
  readonly version: string;
  readonly arch?: DesktopBuildArch | undefined;
  readonly productName: string;
  readonly updateChannel: "latest" | "nightly" | "gmacko";
  /** Preview builds get no update feed. */
  readonly isPreview: boolean;
  readonly githubPublishConfig: GitHubPublishConfig | undefined;
  readonly mockUpdates: boolean;
  readonly mockUpdateServerUrl: string;
  readonly wslRuntimeBundled: boolean;
  readonly repoRoot: string;
  readonly macSignScriptPath?: string | undefined;
  readonly macPasskeySigning?:
    | {
        readonly entitlementsPath: string;
        readonly provisioningProfilePath: string;
      }
    | undefined;
  /** Merged into the Windows config: Azure options on Windows hosts, the jsign hook elsewhere. */
  readonly windowsSigning?: Record<string, unknown> | undefined;
}

/** The electron-builder config from inputs build-desktop-artifact.ts has already resolved. */
export function createDesktopElectronBuilderConfig(
  input: CreateDesktopElectronBuilderConfigInput,
): Record<string, unknown> {
  const { platform, target, productName, updateChannel } = input;
  const appIdentity = getDesktopRuntimeIdentity({
    isDevelopment: false,
    appDisplayName: productName,
  });
  const buildConfig: Record<string, unknown> = {
    afterPack: NodePath.join(input.repoRoot, "scripts/prepare-server-compile-cache.cjs"),
    appId: appIdentity.appId,
    productName,
    artifactName: "T3-Code-${version}-${arch}.${ext}",
    electronLanguages: [...DESKTOP_ELECTRON_LANGUAGES],
    files: [
      ...DESKTOP_FILE_EXCLUSIONS,
      ...(platform === "mac"
        ? resolveMacFileExclusions(input.arch)
        : platform === "linux"
          ? LINUX_FILE_EXCLUSIONS
          : []),
    ],
    directories: {
      buildResources: "apps/desktop/resources",
    },
    // Disable smart unpack so native packages' JS/metadata stay archived and avoid slowing NSIS with loose files.
    ...(platform === "win"
      ? { asar: { smartUnpack: false }, asarUnpack: [WINDOWS_NATIVE_ASAR_UNPACK_GLOB] }
      : {}),
    extraResources: [
      ...DESKTOP_EXTRA_RESOURCES,
      ...(platform === "linux" ? LINUX_CAPTURE_EXTRA_RESOURCES : []),
      ...(platform === "linux" ? LINUX_BROWSER_SECRET_EXTRA_RESOURCES : []),
      ...(platform === "win" ? WINDOWS_SERVER_EXTRA_RESOURCES : []),
      ...(platform === "win" && input.wslRuntimeBundled ? WSL_RUNTIME_EXTRA_RESOURCES : []),
    ],
  };
  // Missing publish config infers a GitHub feed from tokens; staging has no repository, so manifest generation would crash.
  buildConfig.publish = null;
  if (!input.isPreview) {
    const publishConfig = input.githubPublishConfig;
    if (publishConfig) {
      buildConfig.publish = [
        updateChannel === "gmacko"
          ? { ...publishConfig, updaterCacheDirName: appIdentity.updaterCacheDirName }
          : publishConfig,
      ];
    } else if (input.mockUpdates) {
      buildConfig.publish = [
        {
          provider: "generic",
          url: input.mockUpdateServerUrl,
          ...(updateChannel === "gmacko"
            ? { updaterCacheDirName: appIdentity.updaterCacheDirName }
            : {}),
        },
      ];
    }
  }

  if (platform === "mac") {
    buildConfig.mac = {
      target: target === "dmg" ? [target, "zip"] : [target],
      icon: "icon.icns",
      category: "public.app-category.developer-tools",
      extendInfo: {
        // macOS 26 offers Messages/Mail codes in every text field unless opted out.
        NSAutoFillRequiresTextContentTypeForOneTimeCodeOnMac: true,
        NSLocalNetworkUsageDescription:
          "T3 Code connects to devices on your local network for remote environments and commands run by terminals and coding agents.",
        NSScreenCaptureUsageDescription:
          "T3 Code captures the active window when you use the window capture shortcut.",
        NSCameraUsageDescription:
          "T3 Code lets commands run by terminals and coding agents use the camera.",
        NSMicrophoneUsageDescription:
          "T3 Code lets commands run by terminals and coding agents use the microphone.",
        // macOS lists an app under Default web browser only when it opens web
        // pages as documents as well as http and https links (see protocols).
        CFBundleDocumentTypes: [
          {
            CFBundleTypeName: "Web page",
            CFBundleTypeRole: "Viewer",
            LSHandlerRank: "Alternate",
            LSItemContentTypes: ["public.html", "public.xhtml"],
          },
        ],
      },
      protocols: [
        {
          name: "T3 Code",
          schemes: ["t3code", "t3code-dev"],
        },
        {
          name: "Web site URL",
          schemes: ["http", "https"],
          role: "Viewer",
        },
      ],
      ...(input.macSignScriptPath === undefined ? {} : { sign: input.macSignScriptPath }),
      ...(input.macPasskeySigning
        ? {
            entitlements: input.macPasskeySigning.entitlementsPath,
            provisioningProfile: input.macPasskeySigning.provisioningProfilePath,
          }
        : {}),
    };
  }

  if (platform === "mac" && target === "dmg") {
    buildConfig.dmg = {
      // Finder caches DMG backgrounds by volume name; give each installer its own.
      title: `${productName} ${input.version} Installer`,
      background: `dmg/dmg-background-${updateChannel === "gmacko" ? "latest" : updateChannel}.png`,
      window: {
        width: 640,
        // DMG bounds include Finder's 32px title bar; keep that artwork strip clear.
        height: 432,
      },
      contents: [
        { x: 166, y: 214, type: "file" },
        { x: 474, y: 214, type: "link", path: "/Applications" },
      ],
      iconSize: 120,
      iconTextSize: 12,
    };
  }

  if (platform === "linux") {
    // Pin the static AppImage runtime so hosts with only FUSE 3 do not need libfuse2.
    buildConfig.toolsets = { appimage: "1.0.3" };
    buildConfig.linux = {
      target: target === "AppImage" ? [target, "deb"] : [target],
      executableName: "t3code",
      icon: "icons",
      category: "Development",
      synopsis: "Desktop GUI for coding agents",
      maintainer: "T3 Tools <hello@t3.codes>",
      protocols: [
        {
          name: "T3 Code",
          schemes: ["t3code", "t3code-dev"],
        },
      ],
      desktop: {
        entry: {
          StartupWMClass: "t3code",
        },
      },
    };
    buildConfig.deb = {
      // FPM runs outside the staged app directory, so source paths must be absolute.
      fpm: [
        `${NodePath.join(input.repoRoot, "apps/desktop/resources/linux/com.t3tools.t3code.metainfo.xml")}=/usr/share/metainfo/com.t3tools.t3code.metainfo.xml`,
        `${NodePath.join(input.repoRoot, "LICENSE")}=/usr/share/doc/t3code/copyright`,
      ],
      // Debian 13 and Ubuntu 24.04 use 64-bit-time names; retain old-name fallbacks.
      depends: [
        "libasound2t64 | libasound2",
        "libatspi2.0-0t64 | libatspi2.0-0",
        "libgbm1",
        "libgtk-3-0t64 | libgtk-3-0",
        "libnotify4",
        "libnss3",
        "libsecret-1-0",
        "libuuid1",
        "libxss1",
        "libxtst6",
        "xdg-utils",
      ],
    };
  }

  if (platform === "win") {
    buildConfig.npmRebuild = false;
    buildConfig.nsis = {
      differentialPackage: true,
      include: "apps/desktop/resources/installer.nsh",
    };
    const winConfig: Record<string, unknown> = {
      target: [target],
      icon: "icon.ico",
      // Smart App Control validates unpacked native libraries independently; sign them too.
      signExts: [".node", ".dll"],
      // Resource editing sets product icons even when code signing is disabled.
      signAndEditExecutable: true,
    };
    Object.assign(winConfig, input.windowsSigning);
    buildConfig.win = winConfig;
  }

  return buildConfig;
}
