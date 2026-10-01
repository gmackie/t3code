// Mint fresh App Store provisioning profiles for the GMACKO iOS targets through
// the public App Store Connect API and install them for xcodebuild.
//
// xcodebuild's own provisioning path (-allowProvisioningUpdates with an API
// key) is refused by the developer portal for this team, so signing is manual:
// the distribution identity lives in a local keychain and the profiles come
// from here. Profiles are recreated every run so they always reflect the App
// IDs' current capabilities and App Group assignments.
//
// Usage: node scripts/gmacko-ios-profiles.ts <cert-sha1> <bundle-id>...
// Env: APPLE_API_KEY_PATH, APPLE_API_KEY_ID, APPLE_API_ISSUER
// Prints one "<bundle-id> <profile-uuid>" line per bundle ID.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

const [certSha1, ...bundleIds] = process.argv.slice(2);
const { APPLE_API_KEY_PATH, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env;
if (
  !certSha1 ||
  bundleIds.length === 0 ||
  !APPLE_API_KEY_PATH ||
  !APPLE_API_KEY_ID ||
  !APPLE_API_ISSUER
) {
  console.error("usage: gmacko-ios-profiles.ts <cert-sha1> <bundle-id>... (with APPLE_API_* env)");
  process.exit(1);
}

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${encode({ alg: "ES256", kid: APPLE_API_KEY_ID, typ: "JWT" })}.${encode({
  iss: APPLE_API_ISSUER,
  iat: now,
  exp: now + 900,
  aud: "appstoreconnect-v1",
})}`;
const signature = NodeCrypto.sign("sha256", Buffer.from(unsigned), {
  key: NodeFS.readFileSync(APPLE_API_KEY_PATH),
  dsaEncoding: "ieee-p1363",
}).toString("base64url");
const token = `${unsigned}.${signature}`;

interface Resource {
  readonly id: string;
  readonly attributes: Record<string, string | undefined>;
}

async function api<Data extends Resource | Resource[]>(
  method: string,
  path: string,
  body?: object,
): Promise<{ data: Data }> {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  return JSON.parse(text || '{"data":[]}') as { data: Data };
}

const certificates = (
  await api<Resource[]>("GET", "/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=200")
).data;
const certificate = certificates.find(
  (entry) =>
    NodeCrypto.createHash("sha1")
      .update(Buffer.from(entry.attributes.certificateContent ?? "", "base64"))
      .digest("hex")
      .toUpperCase() === certSha1.toUpperCase(),
);
if (!certificate) throw new Error(`No Apple Distribution certificate matches ${certSha1}.`);

const profileDir = NodePath.join(NodeOS.homedir(), "Library/MobileDevice/Provisioning Profiles");
NodeFS.mkdirSync(profileDir, { recursive: true });

for (const identifier of bundleIds) {
  const bundleId = (
    await api<Resource[]>("GET", `/v1/bundleIds?filter[identifier]=${identifier}&limit=20`)
  ).data.find((entry) => entry.attributes.identifier === identifier);
  if (!bundleId) throw new Error(`App ID ${identifier} is not registered.`);
  const name = `gmacko AppStore ${identifier}`;
  const existing = (
    await api<Resource[]>("GET", `/v1/profiles?filter[name]=${encodeURIComponent(name)}&limit=20`)
  ).data;
  for (const profile of existing) await api("DELETE", `/v1/profiles/${profile.id}`);
  const profile = (
    await api<Resource>("POST", "/v1/profiles", {
      data: {
        type: "profiles",
        attributes: { name, profileType: "IOS_APP_STORE" },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: bundleId.id } },
          certificates: { data: [{ type: "certificates", id: certificate.id }] },
        },
      },
    })
  ).data;
  NodeFS.writeFileSync(
    NodePath.join(profileDir, `${profile.attributes.uuid}.mobileprovision`),
    Buffer.from(profile.attributes.profileContent ?? "", "base64"),
  );
  console.log(`${identifier} ${profile.attributes.uuid}`);
}
