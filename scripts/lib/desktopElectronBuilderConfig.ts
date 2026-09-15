import { getDesktopRuntimeIdentity } from "../../apps/desktop/src/appIdentity.js";

export type DesktopBuildPlatform = "mac" | "linux" | "win";

export interface GitHubPublishConfig {
  readonly provider: "github";
  readonly owner: string;
  readonly repo: string;
  readonly releaseType: "release" | "prerelease";
  readonly channel?: string;
  readonly updaterCacheDirName?: string;
}

interface CreateDesktopElectronBuilderConfigInput {
  readonly platform: DesktopBuildPlatform;
  readonly target: string;
  readonly productName: string;
  readonly publishConfig?: GitHubPublishConfig;
  readonly mockUpdates?: boolean;
  readonly mockUpdateServerPort?: number;
}

export function createDesktopElectronBuilderConfig(
  input: CreateDesktopElectronBuilderConfigInput,
): Record<string, unknown> {
  const appIdentity = getDesktopRuntimeIdentity({
    isDevelopment: false,
    appDisplayName: input.productName,
  });
  const buildConfig: Record<string, unknown> = {
    appId: appIdentity.appId,
    productName: input.productName,
    artifactName: "T3-Code-${version}-${arch}.${ext}",
    asar: false,
    directories: {
      buildResources: "apps/desktop/resources",
    },
  };

  if (input.publishConfig) {
    buildConfig.publish = [
      {
        ...input.publishConfig,
        updaterCacheDirName: appIdentity.updaterCacheDirName,
      },
    ];
  } else if (input.mockUpdates) {
    buildConfig.publish = [
      {
        provider: "generic",
        url: `http://localhost:${input.mockUpdateServerPort ?? 3000}`,
        updaterCacheDirName: appIdentity.updaterCacheDirName,
      },
    ];
  }

  if (input.platform === "mac") {
    buildConfig.mac = {
      target: input.target === "dmg" ? [input.target, "zip"] : [input.target],
      icon: "icon.icns",
      category: "public.app-category.developer-tools",
    };
  }

  if (input.platform === "linux") {
    buildConfig.linux = {
      target: [input.target],
      executableName: "t3code",
      icon: "icon.png",
      category: "Development",
      desktop: {
        entry: {
          StartupWMClass: "t3code",
        },
      },
    };
  }

  if (input.platform === "win") {
    buildConfig.win = {
      target: [input.target],
      icon: "icon.ico",
    };
  }

  return buildConfig;
}
