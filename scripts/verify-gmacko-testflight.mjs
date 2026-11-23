import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeURL from "node:url";

export async function waitForTestFlight({
  buildNumber,
  request,
  pause = NodeTimersPromises.setTimeout,
  attempts = 90,
}) {
  let appId;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!appId) {
      const apps = await request("/v1/apps?filter[bundleId]=com.gmacko.t3code");
      if (apps.transient) {
        if (attempt + 1 < attempts) await pause(30_000);
        continue;
      }
      if (apps.data.length !== 1) throw new Error("Expected one GMACKO app in App Store Connect.");
      appId = apps.data[0].id;
    }
    const query = new URLSearchParams({
      "filter[app]": appId,
      "filter[version]": buildNumber,
      include: "buildBetaDetail",
    });
    const { data, included = [] } = await request(`/v1/builds?${query}`);
    const build = data.find(({ attributes }) => attributes.version === buildNumber);
    if (build) {
      const { processingState, expired } = build.attributes;
      const detailId = build.relationships?.buildBetaDetail?.data?.id;
      const state = included.find(({ type, id }) => type === "buildBetaDetails" && id === detailId)
        ?.attributes.internalBuildState;
      if (
        expired ||
        ["INVALID", "FAILED"].includes(processingState) ||
        state === "PROCESSING_EXCEPTION"
      ) {
        throw new Error(`TestFlight build ${buildNumber} failed: ${processingState}, ${state}.`);
      }
      if (
        processingState === "VALID" &&
        ["READY_FOR_BETA_TESTING", "IN_BETA_TESTING"].includes(state)
      ) {
        return { buildNumber, buildId: build.id, state };
      }
    }
    if (attempt + 1 < attempts) await pause(30_000);
  }
  throw new Error(`TestFlight build ${buildNumber} did not become ready before the deadline.`);
}

if (process.argv[1] && NodeURL.pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { APPLE_API_KEY_PATH, APPLE_API_KEY_ID, APPLE_API_ISSUER, BUILD_NUMBER } = process.env;
  if (
    !APPLE_API_KEY_PATH ||
    !APPLE_API_KEY_ID ||
    !APPLE_API_ISSUER ||
    !/^\d+$/.test(BUILD_NUMBER ?? "")
  ) {
    throw new Error("App Store Connect credentials and a numeric BUILD_NUMBER are required.");
  }
  const key = NodeCrypto.createPrivateKey(await NodeFSP.readFile(APPLE_API_KEY_PATH));
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const result = await waitForTestFlight({
    buildNumber: BUILD_NUMBER,
    request: async (path) => {
      const iat = Math.floor(Date.now() / 1000);
      const unsigned = `${encode({ alg: "ES256", kid: APPLE_API_KEY_ID, typ: "JWT" })}.${encode({
        iss: APPLE_API_ISSUER,
        iat,
        exp: iat + 600,
        aud: "appstoreconnect-v1",
      })}`;
      const signature = NodeCrypto.sign("sha256", Buffer.from(unsigned), {
        key,
        dsaEncoding: "ieee-p1363",
      }).toString("base64url");
      try {
        const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
          headers: { Authorization: `Bearer ${unsigned}.${signature}` },
          signal: AbortSignal.timeout(15_000),
        });
        if (response.status === 429 || response.status >= 500) return { data: [], transient: true };
        if (!response.ok) throw new Error(`App Store Connect returned HTTP ${response.status}.`);
        return await response.json();
      } catch (error) {
        if (error instanceof TypeError || error.name === "TimeoutError") {
          return { data: [], transient: true };
        }
        throw error;
      }
    },
  });
  console.log(JSON.stringify(result));
}
