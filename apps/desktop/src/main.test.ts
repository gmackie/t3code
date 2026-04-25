import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => {
  const app = {
    commandLine: {
      appendSwitch: vi.fn(),
    },
    dock: {
      setIcon: vi.fn(),
    },
    getAppPath: vi.fn(() => "/tmp/t3code-desktop"),
    getName: vi.fn(() => "T3 Code"),
    getVersion: vi.fn(() => "0.0.0-test"),
    isPackaged: false,
    name: "T3 Code",
    on: vi.fn(),
    runningUnderARM64Translation: false,
    setAboutPanelOptions: vi.fn(),
    setName: vi.fn(),
    setPath: vi.fn(),
    whenReady: vi.fn(() => new Promise(() => {})),
  };

  return {
    app,
    BrowserWindow: {
      getAllWindows: vi.fn(() => []),
      getFocusedWindow: vi.fn(() => null),
    },
    clipboard: {},
    dialog: {
      showErrorBox: vi.fn(),
      showOpenDialog: vi.fn(),
    },
    ipcMain: {
      handle: vi.fn(),
      removeHandler: vi.fn(),
    },
    Menu: {
      buildFromTemplate: vi.fn(),
      setApplicationMenu: vi.fn(),
    },
    nativeImage: {
      createFromNamedImage: vi.fn(() => ({
        resize: () => ({
          isEmpty: () => true,
          setTemplateImage: vi.fn(),
        }),
      })),
    },
    nativeTheme: {
      on: vi.fn(),
      shouldUseDarkColors: false,
      themeSource: "system",
    },
    protocol: {
      registerSchemesAsPrivileged: vi.fn(),
    },
    safeStorage: {
      decryptString: vi.fn(),
      encryptString: vi.fn(),
      isEncryptionAvailable: vi.fn(() => true),
    },
    shell: {
      openExternal: vi.fn(),
    },
  };
});

vi.mock("electron-updater", () => ({
  autoUpdater: {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    channel: "latest",
    downloadUpdate: vi.fn(),
    on: vi.fn(),
    quitAndInstall: vi.fn(),
  },
}));

describe("resolveDesktopServerExposureForMainProcess", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.T3CODE_DESKTOP_LAN_HOST;
    delete process.env.T3CODE_DESKTOP_TAILNET_HOST;
    delete process.env.TS_CERT_DOMAIN;
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: "/tmp/t3code-desktop",
    });
  });

  it("uses the tailnet resolver only for tailnet-accessible mode", async () => {
    process.env.T3CODE_DESKTOP_LAN_HOST = "192.168.1.44";
    const resolveTailnetAdvertisedHost = vi.fn(() => "mackbook.tailnet.ts.net");
    vi.doMock("./tailscale.ts", () => ({
      resolveTailnetAdvertisedHost,
    }));

    const mainModule = (await import("./main.ts")) as {
      resolveDesktopAdvertisedHostOverride: (
        mode: "tailnet-accessible" | "network-accessible" | "local-only",
      ) => string | undefined;
    };

    expect(mainModule.resolveDesktopAdvertisedHostOverride("tailnet-accessible")).toBe(
      "mackbook.tailnet.ts.net",
    );
    expect(mainModule.resolveDesktopAdvertisedHostOverride("network-accessible")).toBe(
      "192.168.1.44",
    );
    expect(mainModule.resolveDesktopAdvertisedHostOverride("local-only")).toBeUndefined();
    expect(resolveTailnetAdvertisedHost).toHaveBeenCalledTimes(1);
  }, 15_000);

  it("falls back or rejects tailnet-accessible when no advertised host is available", async () => {
    const mainModule = (await import("./main.ts")) as {
      resolveDesktopServerExposureForMainProcess: (input: {
        readonly mode: "tailnet-accessible";
        readonly port: number;
        readonly networkInterfaces: NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>;
        readonly rejectIfUnavailable: boolean;
      }) => {
        readonly mode: string;
        readonly endpointUrl: string | null;
      };
    };

    expect(
      mainModule.resolveDesktopServerExposureForMainProcess({
        mode: "tailnet-accessible",
        port: 3773,
        networkInterfaces: {},
        rejectIfUnavailable: false,
      }),
    ).toMatchObject({
      mode: "local-only",
      endpointUrl: null,
    });

    expect(() =>
      mainModule.resolveDesktopServerExposureForMainProcess({
        mode: "tailnet-accessible",
        port: 3773,
        networkInterfaces: {},
        rejectIfUnavailable: true,
      }),
    ).toThrow("No reachable network address is available for this desktop right now.");
  });

  it("does not fall back to a LAN address when tailnet-accessible host detection fails", async () => {
    const mainModule = (await import("./main.ts")) as {
      resolveDesktopServerExposureForMainProcess: (input: {
        readonly mode: "tailnet-accessible";
        readonly port: number;
        readonly networkInterfaces: NodeJS.Dict<import("node:os").NetworkInterfaceInfo[]>;
        readonly rejectIfUnavailable: boolean;
      }) => {
        readonly mode: string;
        readonly endpointUrl: string | null;
      };
    };

    expect(
      mainModule.resolveDesktopServerExposureForMainProcess({
        mode: "tailnet-accessible",
        port: 3773,
        networkInterfaces: {
          en0: [
            {
              address: "192.168.1.44",
              family: "IPv4",
              internal: false,
              netmask: "255.255.255.0",
              cidr: "192.168.1.44/24",
              mac: "00:00:00:00:00:00",
            },
          ],
        },
        rejectIfUnavailable: false,
      }),
    ).toMatchObject({
      mode: "local-only",
      endpointUrl: null,
    });

    expect(() =>
      mainModule.resolveDesktopServerExposureForMainProcess({
        mode: "tailnet-accessible",
        port: 3773,
        networkInterfaces: {
          en0: [
            {
              address: "192.168.1.44",
              family: "IPv4",
              internal: false,
              netmask: "255.255.255.0",
              cidr: "192.168.1.44/24",
              mac: "00:00:00:00:00:00",
            },
          ],
        },
        rejectIfUnavailable: true,
      }),
    ).toThrow("No reachable network address is available for this desktop right now.");
  });
});
