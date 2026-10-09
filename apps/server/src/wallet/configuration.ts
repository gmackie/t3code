// @effect-diagnostics nodeBuiltinImport:off - Used by Playwright's promise-based resource pool.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import { MetaMaskConfiguration, MetaMaskError } from "@t3tools/contracts";

const decodeConfiguration = Schema.decodeUnknownSync(MetaMaskConfiguration);
const decodeManifest = Schema.decodeUnknownSync(
  Schema.Struct({ manifest_version: Schema.Number, version: Schema.String }),
);

/** Operator-owned configuration is reread for every wallet action, including approvals. */
export async function readWalletConfiguration(path: string | undefined) {
  if (!path)
    throw new MetaMaskError({
      code: "unavailable",
      detail: "Set T3CODE_METAMASK_CONFIG to the host's MetaMask configuration file.",
    });
  const configuration = decodeConfiguration(JSON.parse(await NodeFSP.readFile(path, "utf8")));
  if (
    !NodePath.isAbsolute(configuration.chromiumExecutable) ||
    !NodePath.isAbsolute(configuration.extensionDirectory) ||
    configuration.extensionDirectory.includes(",")
  ) {
    throw new MetaMaskError({
      code: "unavailable",
      detail: "MetaMask requires absolute Chromium and extension paths.",
    });
  }
  const manifest = decodeManifest(
    JSON.parse(
      await NodeFSP.readFile(
        NodePath.join(configuration.extensionDirectory, "manifest.json"),
        "utf8",
      ),
    ),
  );
  if (manifest.manifest_version !== 3 || manifest.version !== configuration.extensionVersion) {
    throw new MetaMaskError({
      code: "unavailable",
      detail:
        "Install the configured, supported MetaMask Manifest V3 release before opening its profile.",
    });
  }
  return configuration;
}
