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
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: "/tmp/t3code-desktop",
    });
  });

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
});
