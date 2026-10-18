import { GmackoChangelogManifest } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * The GMACKO changelog manifest travels inside the GitHub release body as an
 * HTML comment, so one releases API call returns every build's manifest while
 * the rendered release page stays readable. Written by
 * scripts/gmacko-changelog.ts, read by the server's GmackoChangelog service.
 */
const MANIFEST_MARKER = "gmacko-changelog:v1";
const MANIFEST_PATTERN = /<!--\s*gmacko-changelog:v1\s*\n([\s\S]*?)\n-->/;

const decodeManifestJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(GmackoChangelogManifest),
);

export function encodeGmackoChangelogManifest(manifest: GmackoChangelogManifest): string {
  // `-->` can only appear inside JSON strings (commit subjects), where `>` may
  // be escaped; otherwise it would end the comment early.
  const json = JSON.stringify(manifest).replaceAll("-->", "--\\u003e");
  return `<!-- ${MANIFEST_MARKER}\n${json}\n-->`;
}

export function parseGmackoChangelogManifest(body: string): GmackoChangelogManifest | undefined {
  const match = MANIFEST_PATTERN.exec(body);
  if (!match?.[1]) return undefined;
  return Option.getOrUndefined(decodeManifestJson(match[1]));
}

const UPSTREAM_NIGHTLY_TAG = /^v(\d+\.\d+\.\d+-nightly\.(\d{8})\.(\d+))$/;
const GMACKO_TAG = /^v(\d+\.\d+\.\d+-gmacko\.\d{12})$/;

export interface UpstreamNightlyTag {
  readonly version: string;
  /** Upstream's release workflow run number: increases with every nightly. */
  readonly order: number;
}

/** Parses `v0.1.1-nightly.20261018.3315`. Previews and stable tags return undefined. */
export function parseUpstreamNightlyTag(tag: string): UpstreamNightlyTag | undefined {
  const match = UPSTREAM_NIGHTLY_TAG.exec(tag);
  if (!match?.[1] || !match[3]) return undefined;
  return { version: match[1], order: Number(match[3]) };
}

/** Returns the version of a `v0.0.45-gmacko.202610162327` tag. */
export function parseGmackoTag(tag: string): string | undefined {
  return GMACKO_TAG.exec(tag)?.[1];
}

// Re-exported for scripts/gmacko-changelog.ts, whose package depends on shared only.
export type {
  GmackoChangelogChange,
  GmackoChangelogCommit,
  GmackoChangelogManifest,
} from "@t3tools/contracts";
