import * as ChildProcess from "node:child_process";
import * as Crypto from "node:crypto";
import * as FS from "node:fs";
import * as OS from "node:os";
import * as Path from "node:path";
import { DatabaseSync, StatementSync } from "node:sqlite";
import type { Session } from "electron";
import type {
  BrowserCookieDomain,
  BrowserCookieProfile,
  BrowserCookieSameSite,
  BrowserCookieSource,
  BrowserImportCookiesInput,
  BrowserImportCookiesResult,
  BrowserListCookieDomainsInput,
  BrowserRemoveCookieDomainResult,
  BrowserSessionCookie,
} from "@t3tools/contracts";

type BrowserPlatform = "darwin" | "linux";

type BrowserInfo = {
  id: string;
  label: string;
  macDataDir: string | null;
  linuxDataDir: string | null;
  keychainService: string;
  linuxApplication: string | null;
};

type BrowserMatch = {
  browser: BrowserInfo;
  platform: BrowserPlatform;
  cookieDbPath: string;
};

type RawCookieRow = {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Uint8Array;
  path: string;
  expires_utc: number | bigint;
  is_secure: number;
  is_httponly: number;
  has_expires: number;
  samesite: number;
};

type SessionCookieShape = Awaited<ReturnType<Session["cookies"]["get"]>>[number];

export interface BrowserCookieManager {
  listSources: () => Promise<BrowserCookieSource[]>;
  listProfiles: (sourceId: string) => Promise<BrowserCookieProfile[]>;
  listSourceDomains: (input: BrowserListCookieDomainsInput) => Promise<BrowserCookieDomain[]>;
  importDomains: (input: BrowserImportCookiesInput) => Promise<BrowserImportCookiesResult>;
  listSessionCookies: () => Promise<BrowserSessionCookie[]>;
  removeDomain: (domain: string) => Promise<BrowserRemoveCookieDomainResult>;
}

interface BrowserCookieManagerOptions {
  getSession: () => Pick<Session, "cookies">;
  homeDir?: string;
  platform?: NodeJS.Platform;
  readPasswordCommand?: (
    command: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<string | null>;
}

const CHROMIUM_EPOCH_OFFSET = 11644473600000000n;
const COOKIE_METADATA_PREFIX_BYTES = 32;
const PBKDF2_SALT = "saltysalt";
const MAC_ITERATIONS = 1003;
const LINUX_ITERATIONS = 1;
const LINUX_V10_PASSWORD = "peanuts";
const AES_IV = Buffer.alloc(16, 0x20);

const BROWSERS: readonly BrowserInfo[] = [
  {
    id: "chrome",
    label: "Chrome",
    macDataDir: "Google/Chrome",
    linuxDataDir: "google-chrome",
    keychainService: "Chrome Safe Storage",
    linuxApplication: "chrome",
  },
  {
    id: "chromium",
    label: "Chromium",
    macDataDir: "chromium",
    linuxDataDir: "chromium",
    keychainService: "Chromium Safe Storage",
    linuxApplication: "chromium",
  },
  {
    id: "arc",
    label: "Arc",
    macDataDir: "Arc/User Data",
    linuxDataDir: null,
    keychainService: "Arc Safe Storage",
    linuxApplication: null,
  },
  {
    id: "brave",
    label: "Brave",
    macDataDir: "BraveSoftware/Brave-Browser",
    linuxDataDir: "BraveSoftware/Brave-Browser",
    keychainService: "Brave Safe Storage",
    linuxApplication: "brave",
  },
  {
    id: "edge",
    label: "Edge",
    macDataDir: "Microsoft Edge",
    linuxDataDir: "microsoft-edge",
    keychainService: "Microsoft Edge Safe Storage",
    linuxApplication: "microsoft-edge",
  },
];

function deriveKey(password: string, iterations: number): Buffer {
  return Crypto.pbkdf2Sync(password, PBKDF2_SALT, iterations, 16, "sha1");
}

function getPlatform(platform: NodeJS.Platform | undefined): BrowserPlatform {
  if (platform === "darwin" || platform === "linux") {
    return platform;
  }
  throw new Error(`Browser cookie import is not supported on ${platform ?? process.platform}.`);
}

function getBaseDirectory(homeDir: string, platform: BrowserPlatform): string {
  return platform === "darwin"
    ? Path.join(homeDir, "Library", "Application Support")
    : Path.join(homeDir, ".config");
}

function getBrowserDataDirectory(browser: BrowserInfo, platform: BrowserPlatform): string | null {
  return platform === "darwin" ? browser.macDataDir : browser.linuxDataDir;
}

function findBrowser(browserId: string): BrowserInfo {
  const browser = BROWSERS.find((candidate) => candidate.id === browserId);
  if (!browser) {
    throw new Error(`Unsupported cookie source: ${browserId}`);
  }
  return browser;
}

function sanitizeProfileId(profileId: string): string {
  if (profileId.trim().length === 0 || /[/\\]|\.\./.test(profileId)) {
    throw new Error(`Invalid browser profile: ${profileId}`);
  }
  return profileId;
}

function findBrowserMatch(
  browser: BrowserInfo,
  platform: BrowserPlatform,
  homeDir: string,
  profileId: string,
): BrowserMatch | null {
  const dataDirectory = getBrowserDataDirectory(browser, platform);
  if (!dataDirectory) {
    return null;
  }
  const cookieDbPath = Path.join(
    getBaseDirectory(homeDir, platform),
    dataDirectory,
    sanitizeProfileId(profileId),
    "Cookies",
  );
  return FS.existsSync(cookieDbPath) ? { browser, platform, cookieDbPath } : null;
}

function getBrowserMatch(
  browser: BrowserInfo,
  platform: BrowserPlatform,
  homeDir: string,
  profileId: string,
): BrowserMatch {
  const match = findBrowserMatch(browser, platform, homeDir, profileId);
  if (!match) {
    throw new Error(`Could not find a cookie database for ${browser.label} (${profileId}).`);
  }
  return match;
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(FS.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function openCookieDatabaseSnapshot(cookieDbPath: string): DatabaseSync {
  const snapshotPath = Path.join(
    OS.tmpdir(),
    `t3code-browser-cookies-${Crypto.randomUUID()}.sqlite`,
  );
  FS.copyFileSync(cookieDbPath, snapshotPath);

  const walPath = `${cookieDbPath}-wal`;
  const shmPath = `${cookieDbPath}-shm`;
  if (FS.existsSync(walPath)) {
    FS.copyFileSync(walPath, `${snapshotPath}-wal`);
  }
  if (FS.existsSync(shmPath)) {
    FS.copyFileSync(shmPath, `${snapshotPath}-shm`);
  }

  const database = new DatabaseSync(snapshotPath, { open: true, readOnly: true });
  const originalClose = database.close.bind(database);
  database.close = () => {
    originalClose();
    FS.rmSync(snapshotPath, { force: true });
    FS.rmSync(`${snapshotPath}-wal`, { force: true });
    FS.rmSync(`${snapshotPath}-shm`, { force: true });
  };
  return database;
}

function prepareStatement(database: DatabaseSync, sql: string): StatementSync {
  const statement = database.prepare(sql);
  statement.setReadBigInts(true);
  return statement;
}

async function defaultReadPasswordCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const child = ChildProcess.execFile(command, args, { timeout: timeoutMs }, (error, stdout) => {
      if (error) {
        if ("code" in error && typeof error.code === "number") {
          resolve(null);
          return;
        }
        reject(error);
        return;
      }
      const trimmed = stdout.trim();
      resolve(trimmed.length > 0 ? trimmed : null);
    });

    child.once("error", reject);
  });
}

async function getDerivedKeys(
  match: BrowserMatch,
  readPasswordCommand: NonNullable<BrowserCookieManagerOptions["readPasswordCommand"]>,
): Promise<Map<string, Buffer>> {
  if (match.platform === "darwin") {
    const password = await readPasswordCommand(
      "security",
      ["find-generic-password", "-s", match.browser.keychainService, "-w"],
      10_000,
    );
    if (!password) {
      throw new Error(`Unable to read the ${match.browser.label} macOS keychain password.`);
    }
    return new Map([["v10", deriveKey(password, MAC_ITERATIONS)]]);
  }

  const keys = new Map<string, Buffer>();
  keys.set("v10", deriveKey(LINUX_V10_PASSWORD, LINUX_ITERATIONS));

  if (match.browser.linuxApplication) {
    const password = await readPasswordCommand(
      "secret-tool",
      [
        "lookup",
        "xdg:schema",
        "chrome_libsecret_os_crypt_password_v2",
        "application",
        match.browser.linuxApplication,
      ],
      3_000,
    );
    if (password) {
      keys.set("v11", deriveKey(password, LINUX_ITERATIONS));
    }
  }

  return keys;
}

function decryptCookieValue(row: RawCookieRow, derivedKeys: Map<string, Buffer>): string {
  if (row.value.length > 0) {
    return row.value;
  }

  const encryptedValue = Buffer.from(row.encrypted_value ?? new Uint8Array());
  if (encryptedValue.length === 0) {
    return "";
  }

  const prefix = encryptedValue.subarray(0, 3).toString("utf8");
  const key = derivedKeys.get(prefix);
  if (!key) {
    throw new Error(`No key available for Chromium cookie prefix ${prefix}.`);
  }

  const decipher = Crypto.createDecipheriv("aes-128-cbc", key, AES_IV);
  const plaintext = Buffer.concat([decipher.update(encryptedValue.subarray(3)), decipher.final()]);
  if (plaintext.length <= COOKIE_METADATA_PREFIX_BYTES) {
    return "";
  }
  return plaintext.subarray(COOKIE_METADATA_PREFIX_BYTES).toString("utf8");
}

function chromiumEpochToUnixSeconds(epoch: number | bigint, hasExpires: number): number | null {
  if (hasExpires === 0 || epoch === 0 || epoch === 0n) {
    return null;
  }
  return Number((BigInt(epoch) - CHROMIUM_EPOCH_OFFSET) / 1_000_000n);
}

function mapElectronSameSite(value: SessionCookieShape["sameSite"]): BrowserCookieSameSite {
  switch (value) {
    case "no_restriction":
      return "None";
    case "strict":
      return "Strict";
    default:
      return "Lax";
  }
}

function toElectronCookie(row: RawCookieRow, value: string) {
  const expirationDate = chromiumEpochToUnixSeconds(row.expires_utc, row.has_expires);
  return {
    url: toRemovalUrl(row.host_key, row.path, row.is_secure === 1),
    name: row.name,
    value,
    domain: row.host_key,
    path: row.path || "/",
    secure: row.is_secure === 1,
    httpOnly: row.is_httponly === 1,
    sameSite: row.samesite === 0 ? "no_restriction" : row.samesite === 2 ? "strict" : "lax",
    ...(expirationDate === null ? {} : { expirationDate }),
  } as const;
}

function toRemovalUrl(domain: string, pathName: string, secure: boolean): string {
  const host = domain.startsWith(".") ? domain.slice(1) : domain;
  return `${secure ? "https" : "http"}://${host}${pathName || "/"}`;
}

function toExpirationLabel(cookie: SessionCookieShape): string {
  if (cookie.session === true || cookie.expirationDate === undefined) {
    return "Session";
  }
  return new Date(cookie.expirationDate * 1_000).toLocaleString();
}

function compareDomainThenName(
  left: Pick<BrowserCookieDomain, "domain"> | Pick<BrowserSessionCookie, "domain" | "name">,
  right: Pick<BrowserCookieDomain, "domain"> | Pick<BrowserSessionCookie, "domain" | "name">,
): number {
  const domainCompare = left.domain.localeCompare(right.domain);
  if (domainCompare !== 0) {
    return domainCompare;
  }
  if ("name" in left && "name" in right) {
    return left.name.localeCompare(right.name);
  }
  return 0;
}

export function createBrowserCookieManager(
  options: BrowserCookieManagerOptions,
): BrowserCookieManager {
  const homeDir = options.homeDir ?? OS.homedir();
  const platform = getPlatform(options.platform ?? process.platform);
  const readPasswordCommand = options.readPasswordCommand ?? defaultReadPasswordCommand;
  const getSession = (): Pick<Session, "cookies"> => options.getSession();

  return {
    async listSources() {
      return BROWSERS.flatMap((browser) =>
        findBrowserMatch(browser, platform, homeDir, "Default")
          ? [{ id: browser.id, label: browser.label }]
          : [],
      );
    },

    async listProfiles(sourceId) {
      const browser = findBrowser(sourceId);
      const dataDirectory = getBrowserDataDirectory(browser, platform);
      if (!dataDirectory) {
        return [];
      }

      const browserRoot = Path.join(getBaseDirectory(homeDir, platform), dataDirectory);
      if (!FS.existsSync(browserRoot)) {
        return [];
      }

      const entries = FS.readdirSync(browserRoot, { withFileTypes: true });
      return entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            (entry.name === "Default" || entry.name.startsWith("Profile ")) &&
            FS.existsSync(Path.join(browserRoot, entry.name, "Cookies")),
        )
        .map((entry) => {
          const preferences = readJsonFile(Path.join(browserRoot, entry.name, "Preferences"));
          const accountLabel =
            typeof preferences === "object" &&
            preferences !== null &&
            Array.isArray(Reflect.get(preferences, "account_info")) &&
            typeof Reflect.get(Reflect.get(preferences, "account_info")[0] ?? {}, "email") ===
              "string"
              ? (Reflect.get(Reflect.get(preferences, "account_info")[0] ?? {}, "email") as string)
              : null;
          const profileLabel =
            typeof preferences === "object" && preferences !== null
              ? Reflect.get(Reflect.get(preferences, "profile") ?? {}, "name")
              : null;

          return {
            id: entry.name,
            label:
              accountLabel ??
              (typeof profileLabel === "string" && profileLabel.trim().length > 0
                ? profileLabel
                : entry.name),
          };
        })
        .toSorted((left, right) => left.id.localeCompare(right.id));
    },

    async listSourceDomains(input) {
      const browser = findBrowser(input.sourceId);
      const match = getBrowserMatch(browser, platform, homeDir, input.profileId);
      const database = openCookieDatabaseSnapshot(match.cookieDbPath);
      try {
        const now = BigInt(Date.now()) * 1_000n + CHROMIUM_EPOCH_OFFSET;
        const rows = prepareStatement(
          database,
          `SELECT host_key AS domain, COUNT(*) AS count
           FROM cookies
           WHERE has_expires = 0 OR expires_utc > ?
           GROUP BY host_key
           ORDER BY host_key ASC`,
        )
          .all(now)
          .map((row) => ({
            domain: String(Reflect.get(row, "domain")),
            count: Number(Reflect.get(row, "count")),
          })) as BrowserCookieDomain[];

        const searchNeedle = input.search?.trim().toLowerCase() ?? "";
        const filteredRows =
          searchNeedle.length === 0
            ? rows
            : rows.filter((row) => row.domain.toLowerCase().includes(searchNeedle));

        return filteredRows.toSorted(compareDomainThenName);
      } finally {
        database.close();
      }
    },

    async importDomains(input) {
      const browser = findBrowser(input.sourceId);
      const match = getBrowserMatch(browser, platform, homeDir, input.profileId);
      const database = openCookieDatabaseSnapshot(match.cookieDbPath);
      try {
        const derivedKeys = await getDerivedKeys(match, readPasswordCommand);
        const normalizedDomains = [...new Set(input.domains.map((domain) => domain.trim()))].filter(
          (domain) => domain.length > 0,
        );
        if (normalizedDomains.length === 0) {
          return {
            importedCount: 0,
            failedCount: 0,
            importedDomains: [],
          };
        }

        const placeholders = normalizedDomains.map(() => "?").join(",");
        const now = BigInt(Date.now()) * 1_000n + CHROMIUM_EPOCH_OFFSET;
        const rows = prepareStatement(
          database,
          `SELECT host_key, name, value, encrypted_value, path, expires_utc,
                  is_secure, is_httponly, has_expires, samesite
           FROM cookies
           WHERE host_key IN (${placeholders})
             AND (has_expires = 0 OR expires_utc > ?)`,
        ).all(...normalizedDomains, now) as RawCookieRow[];

        let importedCount = 0;
        let failedCount = 0;
        const countsByDomain = new Map<string, number>();

        for (const row of rows) {
          try {
            const value = decryptCookieValue(row, derivedKeys);
            await getSession().cookies.set(toElectronCookie(row, value));
            importedCount += 1;
            countsByDomain.set(row.host_key, (countsByDomain.get(row.host_key) ?? 0) + 1);
          } catch {
            failedCount += 1;
          }
        }

        return {
          importedCount,
          failedCount,
          importedDomains: [...countsByDomain.entries()]
            .map(([domain, count]) => ({ domain, count }))
            .toSorted(compareDomainThenName),
        };
      } finally {
        database.close();
      }
    },

    async listSessionCookies() {
      const cookies = await getSession().cookies.get({});
      return cookies
        .flatMap((cookie) => {
          if (!cookie.domain) {
            return [];
          }
          const pathName = cookie.path ?? "/";
          return [
            {
              domain: cookie.domain,
              name: cookie.name,
              path: pathName,
              secure: cookie.secure === true,
              httpOnly: cookie.httpOnly === true,
              sameSite: mapElectronSameSite(cookie.sameSite),
              expirationLabel: toExpirationLabel(cookie),
              removalUrl: toRemovalUrl(cookie.domain, pathName, cookie.secure === true),
            },
          ];
        })
        .toSorted(compareDomainThenName);
    },

    async removeDomain(domain) {
      const cookies = await getSession().cookies.get({});
      const cookiesForDomain = cookies.flatMap((cookie) => {
        if (cookie.domain !== domain) {
          return [];
        }
        return [
          {
            domain: cookie.domain,
            path: cookie.path ?? "/",
            secure: cookie.secure === true,
            name: cookie.name,
          },
        ];
      });
      for (const cookie of cookiesForDomain) {
        await getSession().cookies.remove(
          toRemovalUrl(cookie.domain, cookie.path, cookie.secure),
          cookie.name,
        );
      }
      return { removedCount: cookiesForDomain.length };
    },
  };
}
