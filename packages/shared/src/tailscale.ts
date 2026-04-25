import { execFileSync } from "node:child_process";

function firstNonEmpty(values: ReadonlyArray<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value) => value && value.length > 0);
}

export function resolveTailnetAdvertisedHost(input?: {
  readonly tailnetHost?: string;
  readonly tsCertDomain?: string;
}): string | null {
  const directHost = firstNonEmpty([input?.tailnetHost, input?.tsCertDomain]);
  if (directHost) {
    return directHost;
  }

  try {
    const output = execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8" });
    return firstNonEmpty(output.split(/\s+/)) ?? null;
  } catch {
    return null;
  }
}
