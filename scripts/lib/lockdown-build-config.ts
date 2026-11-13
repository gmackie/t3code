import { LOCKDOWN_EDITION, LOCKDOWN_IDENTITY } from "@t3tools/shared/lockdownEdition";

type BuildConfig = Record<string, unknown>;
type Protocol = { readonly name: string; readonly schemes: ReadonlyArray<string> };

const lockdownProtocols: ReadonlyArray<Protocol> = [
  {
    name: LOCKDOWN_IDENTITY.productName,
    schemes: [LOCKDOWN_IDENTITY.scheme, LOCKDOWN_IDENTITY.devScheme],
  },
];

const asRecord = (value: unknown): BuildConfig | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as BuildConfig)
    : undefined;

/**
 * T3 Code Locked packaging: its own app id, name, artifact names and protocol, no update feed
 * (electron-updater then has nothing to check), and no claim on http/https links.
 */
export function applyLockdownBuildConfig(buildConfig: BuildConfig): BuildConfig {
  if (!LOCKDOWN_EDITION) return buildConfig;
  const config: BuildConfig = {
    ...buildConfig,
    appId: LOCKDOWN_IDENTITY.appId,
    productName: LOCKDOWN_IDENTITY.productName,
    artifactName: `${LOCKDOWN_IDENTITY.artifactPrefix}-\${version}-\${arch}.\${ext}`,
    publish: null,
  };
  const mac = asRecord(config.mac);
  if (mac !== undefined) {
    const extendInfo = asRecord(mac.extendInfo) ?? {};
    const { CFBundleDocumentTypes: _webPages, ...keptInfo } = extendInfo;
    config.mac = { ...mac, extendInfo: keptInfo, protocols: lockdownProtocols };
  }
  const dmg = asRecord(config.dmg);
  if (dmg !== undefined && typeof dmg.title === "string") {
    config.dmg = {
      ...dmg,
      title: dmg.title.replace(/^T3 Code(?: \([^)]*\))?/, LOCKDOWN_IDENTITY.productName),
    };
  }
  const linux = asRecord(config.linux);
  if (linux !== undefined) {
    // The executable and WM class stay upstream's: the desktop entry and icons are keyed to them.
    config.linux = { ...linux, protocols: lockdownProtocols };
  }
  return config;
}
