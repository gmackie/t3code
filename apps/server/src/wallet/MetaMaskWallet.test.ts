import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { type MetaMaskConfiguration, type MetaMaskRequestInput } from "@t3tools/contracts";
import { MetaMaskWallet } from "./MetaMaskWallet.ts";

const fixtures = vi.hoisted(() => ({
  configuration: undefined as MetaMaskConfiguration | undefined,
  approvals: [] as Array<{
    id: string;
    origin: string;
    method: "eth_sendTransaction";
    account: string;
    chainId: string;
    transaction: { to: string; value: string };
  }>,
  confirmation: vi.fn(async () => true),
}));
vi.mock("./configuration.ts", () => ({
  readWalletConfiguration: async () => fixtures.configuration,
}));
vi.mock("./MetaMaskBridge.ts", async (original) => ({
  ...(await original<typeof import("./MetaMaskBridge.ts")>()),
  readMetaMaskState: async () => ({ isUnlocked: true, pendingApprovals: {} }),
  decodeMetaMaskApprovals: () => ({ unlocked: true, approvals: fixtures.approvals }),
  confirmMetaMaskApproval: () => fixtures.confirmation(),
}));
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await NodeFSP.rm(directory, { recursive: true, force: true });
  fixtures.approvals = [];
});

async function setup() {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-wallet-test-"));
  directories.push(directory);
  const account = "0x1111111111111111111111111111111111111111";
  const to = "0x2222222222222222222222222222222222222222";
  fixtures.configuration = {
    chromiumExecutable: "/chrome",
    extensionDirectory: "/metamask",
    extensionId: "a".repeat(32),
    extensionVersion: "13.5.0",
    grants: [
      {
        threadId: "thread-a",
        origin: "https://attest.gmac.io",
        account,
        chainId: "0x1",
        methods: ["eth_sendTransaction"],
        expiresAt: "2099-01-01T00:00:00Z",
        maxValueWei: "0xa",
        recipients: [to],
        allowContractCalls: false,
      },
    ],
  };
  const completion = Promise.withResolvers<unknown>();
  const confirmation = fixtures.confirmation;
  confirmation.mockClear();
  let extensionUrl = "";
  const extension = {
    goto: vi.fn(async (url: string) => {
      extensionUrl = url;
    }),
    on: vi.fn(),
    url: () => extensionUrl,
    isClosed: () => false,
    getByTestId: () => ({ waitFor: vi.fn(async () => undefined) }),
    evaluate: confirmation,
  };
  const rpc = vi.fn((expression: string) =>
    expression.includes("eth_chainId") ? Promise.resolve("0x1") : completion.promise,
  );
  const website = {
    url: vi.fn(() => "https://attest.gmac.io/"),
    goto: vi.fn(async () => undefined),
    isClosed: () => false,
    waitForFunction: vi.fn(async () => undefined),
    evaluate: rpc,
  };
  const context = {
    on: vi.fn((_event: string, _listener: (page: Page) => void) => undefined),
    pages: vi.fn((): Page[] => []),
    serviceWorkers: () => [{ url: () => `chrome-extension://${"a".repeat(32)}/background.js` }],
    newPage: vi.fn().mockResolvedValueOnce(extension).mockResolvedValue(website),
    once: vi.fn(),
    close: vi.fn(async () => undefined),
  };
  const options = {
    configurationPath: "/test/config.json",
    journalDirectory: directory,
    context: async () => context as unknown as BrowserContext,
    showPage: vi.fn(async (_thread: string, _page: Page) => "tab-a"),
  };
  const wallet = new MetaMaskWallet(options);
  const input: MetaMaskRequestInput = {
    clientRequestId: "request-a",
    origin: "https://attest.gmac.io",
    method: "eth_sendTransaction",
    account,
    chainId: "0x1",
    transaction: { to, value: "0xa" },
  };
  return { wallet, options, input, rpc, completion, confirmation, website, extension, context };
}

describe("MetaMask request lifecycle", () => {
  it("refuses dispatch after the website navigates to another origin", async () => {
    const { wallet, input, rpc, website } = await setup();
    await wallet.open("thread-a");
    website.url.mockReturnValue("https://other.example/");
    await expect(wallet.request("thread-a", input)).rejects.toThrow("navigated away");
    expect(rpc).not.toHaveBeenCalled();
    await wallet.close("thread-a");
  });
  it("dispatches concurrent retries once and refuses reuse with different intent", async () => {
    const { wallet, input, rpc, completion } = await setup();
    const outcomes = await Promise.all([
      wallet.request("thread-a", input),
      wallet.request("thread-a", input),
    ]);
    expect(outcomes.map((result) => result.status)).toEqual(["pending", "pending"]);
    expect(rpc).toHaveBeenCalledTimes(2); // chain read plus one submission
    await expect(
      wallet.request("thread-a", {
        ...input,
        transaction: { ...input.transaction!, value: "0x1" },
      }),
    ).rejects.toThrow("different wallet request");
    completion.resolve("0xtransaction");
    await wallet.close("thread-a");
  });
  it("never resends an unfinished request after a server restart", async () => {
    const { wallet, options, input, rpc, completion } = await setup();
    await wallet.request("thread-a", input);
    const restarted = new MetaMaskWallet(options);
    expect((await restarted.result("thread-a", input.clientRequestId)).status).toBe("unknown");
    await expect(restarted.request("thread-a", input)).resolves.toMatchObject({
      status: "unknown",
    });
    expect(rpc).toHaveBeenCalledTimes(2);
    completion.resolve("0xtransaction");
    await wallet.close("thread-a");
  });
  it("cannot read another thread's request journal", async () => {
    const { wallet, input, completion } = await setup();
    await wallet.request("thread-a", input);
    await expect(wallet.result("thread-b", input.clientRequestId)).rejects.toThrow(
      "No wallet request",
    );
    completion.resolve("0xtransaction");
    await wallet.close("thread-a");
  });
  it("submits an unchanged confirmation covered by a current grant", async () => {
    const { wallet, input, confirmation } = await setup();
    fixtures.approvals = [
      {
        id: "approval-a",
        origin: input.origin,
        method: "eth_sendTransaction",
        account: input.account,
        chainId: input.chainId,
        transaction: input.transaction!,
      },
    ];
    const [pending] = (await wallet.pending("thread-a")).approvals;
    if (!pending) throw new Error("Missing fixture");
    await expect(
      wallet.approve("thread-a", pending.id, pending.fingerprint),
    ).resolves.toMatchObject({ status: "submitted" });
    expect(confirmation).toHaveBeenCalledTimes(1);
  });
  it("refuses a confirmation whose intent changes while its UI opens", async () => {
    const { wallet, input, confirmation, extension } = await setup();
    fixtures.approvals = [
      {
        id: "approval-a",
        origin: input.origin,
        method: "eth_sendTransaction",
        account: input.account,
        chainId: input.chainId,
        transaction: input.transaction!,
      },
    ];
    const [pending] = (await wallet.pending("thread-a")).approvals;
    if (!pending) throw new Error("Missing fixture");
    extension.goto.mockImplementation(async () => {
      fixtures.approvals = fixtures.approvals.map((approval) => ({
        ...approval,
        transaction: { ...approval.transaction, value: "0x1" },
      }));
    });
    await expect(wallet.approve("thread-a", pending.id, pending.fingerprint)).rejects.toThrow(
      "confirmation changed",
    );
    expect(confirmation).not.toHaveBeenCalled();
  });
  it("rereads revoked grants before clicking a pending confirmation", async () => {
    const { wallet, input, confirmation } = await setup();
    fixtures.approvals = [
      {
        id: "approval-a",
        origin: input.origin,
        method: "eth_sendTransaction",
        account: input.account,
        chainId: input.chainId,
        transaction: input.transaction!,
      },
    ];
    const [pending] = (await wallet.pending("thread-a")).approvals;
    if (!pending || !fixtures.configuration) throw new Error("Missing fixture");
    fixtures.configuration = { ...fixtures.configuration, grants: [] };
    await expect(wallet.approve("thread-a", pending.id, pending.fingerprint)).rejects.toThrow(
      "No current wallet grant",
    );
    expect(confirmation).not.toHaveBeenCalled();
  });
});

describe("MetaMask extension home lifecycle", () => {
  it("reuses the existing home and closes startup duplicates", async () => {
    const { wallet, context, extension } = await setup();
    const homeUrl = `chrome-extension://${"a".repeat(32)}/home.html`;
    await extension.goto(homeUrl);
    const duplicate = { url: () => homeUrl, on: vi.fn(), close: vi.fn(async () => undefined) };
    context.pages.mockReturnValue([extension, duplicate] as unknown as Page[]);
    await wallet.pending("thread-a");
    expect(context.newPage).not.toHaveBeenCalled();
    expect(duplicate.close).toHaveBeenCalled();
  });

  it("closes late duplicate home pages while preserving notification windows", async () => {
    const { wallet, context } = await setup();
    await wallet.pending("thread-a");
    const watch = context.on.mock.calls.find(([event]) => event === "page")?.[1] as unknown as (
      page: Page,
    ) => void;
    let url = "about:blank";
    const duplicate = {
      url: () => url,
      on: vi.fn((_event: string, _listener: () => void) => undefined),
      close: vi.fn(async () => undefined),
    };
    watch(duplicate as unknown as Page);
    expect(duplicate.close).not.toHaveBeenCalled();
    url = `chrome-extension://${"a".repeat(32)}/notification.html`;
    const navigate = duplicate.on.mock.calls[0]?.[1] as unknown as () => void;
    navigate();
    expect(duplicate.close).not.toHaveBeenCalled();
    url = `chrome-extension://${"a".repeat(32)}/home.html`;
    navigate();
    expect(duplicate.close).toHaveBeenCalledTimes(1);
  });
});

describe("MetaMask connected wallet status", () => {
  it("reads connected public accounts and balances with no signing grants or access prompts", async () => {
    const { wallet, rpc, input } = await setup();
    fixtures.configuration = { ...fixtures.configuration!, grants: [] };
    await wallet.open("thread-a");
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0xaa36a7";
      if (method === "eth_accounts") return [input.account];
      if (method === "eth_getBalance") return "0x123";
      throw new Error("Unexpected RPC method");
    });
    rpc.mockImplementation((expression) =>
      new Function("window", "location", `return ${expression}`)(
        { ethereum: { isMetaMask: true, request } },
        { origin: input.origin },
      ),
    );
    await expect(wallet.status("thread-a")).resolves.toEqual({
      origin: input.origin,
      unlocked: true,
      chainId: "0xaa36a7",
      accounts: [{ address: input.account, balanceWei: "0x123" }],
    });
    expect(request.mock.calls.map(([call]) => call.method)).toEqual([
      "eth_chainId",
      "eth_accounts",
      "eth_getBalance",
      "eth_chainId",
      "eth_accounts",
    ]);
  });

  it("does not request account access when the site is disconnected", async () => {
    const { wallet, rpc } = await setup();
    await wallet.open("thread-a");
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0xaa36a7";
      if (method === "eth_accounts") return [];
      throw new Error("Unexpected RPC method");
    });
    rpc.mockImplementation((expression) =>
      new Function("window", "location", `return ${expression}`)(
        { ethereum: { isMetaMask: true, request } },
        { origin: "https://attest.gmac.io" },
      ),
    );
    expect((await wallet.status("thread-a")).accounts).toEqual([]);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("rejects a changed network instead of mislabeling balances", async () => {
    const { wallet, rpc } = await setup();
    await wallet.open("thread-a");
    let reads = 0;
    const request = async ({ method }: { method: string }) =>
      method === "eth_chainId" ? (++reads === 1 ? "0xaa36a7" : "0x1") : [];
    rpc.mockImplementation((expression) =>
      new Function("window", "location", `return ${expression}`)(
        { ethereum: { isMetaMask: true, request } },
        { origin: "https://attest.gmac.io" },
      ),
    );
    await expect(wallet.status("thread-a")).rejects.toThrow("Wallet changed");
  });

  it("rejects another thread, ungranted origins, and navigated sites before RPC", async () => {
    const { wallet, rpc, website } = await setup();
    await wallet.open("thread-a");
    await expect(wallet.status("thread-b")).rejects.toThrow("another thread");
    await expect(wallet.status("thread-a", "https://other.example")).rejects.toThrow(
      "allowed website",
    );
    website.url.mockReturnValue("https://other.example/");
    await expect(wallet.status("thread-a")).rejects.toThrow("navigated away");
    expect(rpc).not.toHaveBeenCalled();
  });
});
