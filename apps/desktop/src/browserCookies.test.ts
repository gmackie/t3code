import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createBrowserCookieManager } from "./browserCookies";

const TEST_PASSWORD = "test-keychain-password";
const TEST_KEY = crypto.pbkdf2Sync(TEST_PASSWORD, "saltysalt", 1003, 16, "sha1");
const IV = Buffer.alloc(16, 0x20);
const CHROMIUM_EPOCH_OFFSET = 11644473600000000n;

function chromiumEpoch(unixSeconds: number): bigint {
  return BigInt(unixSeconds) * 1_000_000n + CHROMIUM_EPOCH_OFFSET;
}

function encryptCookieValue(value: string): Uint8Array {
  const metadata = crypto.randomBytes(32);
  const plaintext = Buffer.concat([metadata, Buffer.from(value, "utf8")]);
  const cipher = crypto.createCipheriv("aes-128-cbc", TEST_KEY, IV);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return new Uint8Array(Buffer.concat([Buffer.from("v10"), encrypted]));
}

function createFixtureDb(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE cookies (
    host_key TEXT NOT NULL,
    name TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    encrypted_value BLOB NOT NULL DEFAULT x'',
    path TEXT NOT NULL DEFAULT '/',
    expires_utc INTEGER NOT NULL DEFAULT 0,
    is_secure INTEGER NOT NULL DEFAULT 0,
    is_httponly INTEGER NOT NULL DEFAULT 0,
    has_expires INTEGER NOT NULL DEFAULT 0,
    samesite INTEGER NOT NULL DEFAULT 1
  )`);

  const insert = db.prepare(`INSERT INTO cookies
    (host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, has_expires, samesite)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const futureExpiry = Number(chromiumEpoch(Math.floor(Date.now() / 1000) + 86_400));

  insert.run(
    ".github.com",
    "session_id",
    "",
    encryptCookieValue("abc123"),
    "/",
    futureExpiry,
    1,
    1,
    1,
    1,
  );
  insert.run(".github.com", "theme", "", encryptCookieValue("dark"), "/", futureExpiry, 0, 0, 1, 2);
  insert.run(
    ".example.com",
    "plain_cookie",
    "hello-world",
    new Uint8Array(),
    "/",
    futureExpiry,
    0,
    0,
    1,
    1,
  );

  db.close();
}

type SessionCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "no_restriction" | "unspecified";
  expirationDate?: number;
};

function createCookieSessionStub() {
  let cookies: SessionCookie[] = [];

  return {
    cookies: {
      get: async () => [...cookies],
      set: async (cookie: SessionCookie) => {
        cookies = cookies.filter(
          (existing) =>
            !(
              existing.name === cookie.name &&
              existing.domain === cookie.domain &&
              existing.path === cookie.path
            ),
        );
        cookies.push(cookie);
      },
      remove: async (url: string, name: string) => {
        const parsed = new URL(url);
        const nextCookies = cookies.filter((cookie) => {
          const matchesDomain =
            parsed.hostname === cookie.domain.replace(/^\./, "") ||
            parsed.hostname.endsWith(cookie.domain);
          return !(cookie.name === name && matchesDomain);
        });
        cookies = nextCookies;
      },
    },
  };
}

describe("createBrowserCookieManager", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("lists Chromium domains, imports selected cookies, and removes them from the app session", async () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-browser-cookies-"));
    tempDirs.push(homeDir);

    const profileDir = path.join(
      homeDir,
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "Default",
    );
    fs.mkdirSync(profileDir, { recursive: true });
    createFixtureDb(path.join(profileDir, "Cookies"));

    const manager = createBrowserCookieManager({
      session: createCookieSessionStub() as never,
      homeDir,
      platform: "darwin",
      readPasswordCommand: async () => TEST_PASSWORD,
    });

    await expect(manager.listSources()).resolves.toEqual([
      {
        id: "chrome",
        label: "Chrome",
      },
    ]);
    await expect(manager.listProfiles("chrome")).resolves.toEqual([
      {
        id: "Default",
        label: "Default",
      },
    ]);
    await expect(
      manager.listSourceDomains({
        sourceId: "chrome",
        profileId: "Default",
        search: "git",
      }),
    ).resolves.toEqual([
      {
        count: 2,
        domain: ".github.com",
      },
    ]);

    await expect(
      manager.importDomains({
        sourceId: "chrome",
        profileId: "Default",
        domains: [".github.com"],
      }),
    ).resolves.toEqual({
      failedCount: 0,
      importedCount: 2,
      importedDomains: [
        {
          count: 2,
          domain: ".github.com",
        },
      ],
    });

    await expect(manager.listSessionCookies()).resolves.toEqual([
      expect.objectContaining({
        domain: ".github.com",
        name: "session_id",
      }),
      expect.objectContaining({
        domain: ".github.com",
        name: "theme",
      }),
    ]);

    await expect(manager.removeDomain(".github.com")).resolves.toEqual({ removedCount: 2 });
    await expect(manager.listSessionCookies()).resolves.toEqual([]);
  });
});
