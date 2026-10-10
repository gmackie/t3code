// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Playwright resource ownership and request journal.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import {
  METAMASK_BROWSER_PROFILE_ID,
  METAMASK_DEFAULT_SITE,
  MetaMaskError,
  MetaMaskRequestResult,
  MetaMaskWalletStatus,
  type MetaMaskRequestInput,
} from "@t3tools/contracts";
import type { BrowserContext, Page } from "playwright-core";
import { readWalletConfiguration } from "./configuration.ts";
import { requireWalletGrant, walletRpcParameters } from "./permissions.ts";
import {
  approvalFingerprint,
  decodeMetaMaskApprovals,
  confirmMetaMaskApproval,
  readMetaMaskState,
} from "./MetaMaskBridge.ts";

const decodeAccounts = Schema.decodeUnknownSync(Schema.Array(Schema.String));
const decodeWalletStatus = Schema.decodeUnknownSync(MetaMaskWalletStatus);

const decodeJournal = Schema.decodeUnknownSync(
  Schema.Struct({ fingerprint: Schema.String, outcome: MetaMaskRequestResult }),
);

interface Options {
  readonly configurationPath: string | undefined;
  readonly journalDirectory: string;
  readonly context: () => Promise<BrowserContext>;
  readonly showPage: (threadId: string, page: Page) => Promise<string>;
}

/** A wallet profile has one active thread; extension-created windows inherit that owner. */
export class MetaMaskWallet {
  private readonly options: Options;
  private threadId: string | undefined;
  private context: BrowserContext | undefined;
  private extensionPage: Page | undefined;
  private extensionId: string | undefined;
  private readonly pages = new Map<string, Page>();
  private readonly inFlight = new Map<
    string,
    { fingerprint: string; start: Promise<typeof MetaMaskRequestResult.Type> }
  >();
  private readonly activeRequests = new Set<string>();
  private readonly completions = new Set<Promise<void>>();
  private opening: Promise<void> | undefined;
  private approving = false;

  constructor(options: Options) {
    this.options = options;
  }

  private async connect(threadId: string) {
    if (this.threadId !== undefined && this.threadId !== threadId) {
      throw new MetaMaskError({
        code: "busy",
        detail:
          "The MetaMask profile is open in another thread. Close its wallet session before opening this one.",
      });
    }
    this.threadId = threadId;
    this.opening ??= this.initialize(threadId).catch((cause: unknown) => {
      this.threadId = undefined;
      this.opening = undefined;
      throw cause;
    });
    await this.opening;
  }

  private async initialize(threadId: string) {
    const configuration = await readWalletConfiguration(this.options.configurationPath);
    const context = await this.options.context();
    this.context = context;
    const worker =
      context.serviceWorkers().find((worker) => worker.url().startsWith("chrome-extension://")) ??
      (await context.waitForEvent("serviceworker", {
        predicate: (worker) => worker.url().startsWith("chrome-extension://"),
        timeout: 10000,
      }));
    const extensionId = new URL(worker.url()).host;
    if (configuration.extensionId !== undefined && extensionId !== configuration.extensionId) {
      await context.close();
      throw new MetaMaskError({
        code: "unavailable",
        detail: "The loaded MetaMask extension ID does not match the configured ID.",
      });
    }
    this.extensionId = extensionId;
    const extensionOrigin = `chrome-extension://${extensionId}/`;
    context.once("close", () => {
      this.context = undefined;
      this.extensionPage = undefined;
      this.threadId = undefined;
      this.opening = undefined;
      this.pages.clear();
    });
    const homeUrl = `${extensionOrigin}home.html`;
    const page =
      context.pages().find((page) => page.url().startsWith(homeUrl)) ?? (await context.newPage());
    this.extensionPage = page;
    const watchHome = (candidate: Page) => {
      const closeDuplicate = () => {
        if (candidate !== page && candidate.url().startsWith(homeUrl))
          void candidate.close().catch(() => undefined);
      };
      candidate.on("framenavigated", closeDuplicate);
      closeDuplicate();
    };
    context.on("page", watchHome);
    for (const candidate of context.pages()) watchHome(candidate);
    await page.goto(homeUrl, { waitUntil: "domcontentloaded" });
    // MetaMask can open its own home during extension startup. Keep one UI port and state store.
    for (const duplicate of context.pages()) {
      if (
        duplicate !== page &&
        (duplicate.url().startsWith(homeUrl) || duplicate.url() === "about:blank")
      )
        await duplicate.close();
    }
    await this.options.showPage(threadId, page);
  }

  async open(threadId: string, url = METAMASK_DEFAULT_SITE) {
    await this.connect(threadId);
    const origin = new URL(url).origin;
    if (origin !== METAMASK_DEFAULT_SITE) {
      const configuration = await readWalletConfiguration(this.options.configurationPath);
      if (
        !configuration.grants.some(
          (grant) =>
            grant.threadId === threadId &&
            grant.origin === origin &&
            Date.parse(grant.expiresAt) > Date.now(),
        )
      ) {
        throw new MetaMaskError({
          code: "permission_denied",
          detail: "Open a website covered by a current wallet grant.",
        });
      }
    }
    const context = this.context;
    if (!context) throw new Error("Wallet context closed");
    let page = this.pages.get(origin);
    if (!page || page.isClosed()) {
      page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
      this.pages.set(origin, page);
    }
    const tabId = await this.options.showPage(threadId, page);
    return { tabId, profileId: METAMASK_BROWSER_PROFILE_ID, origin };
  }

  async pending(threadId: string) {
    await this.connect(threadId);
    await readWalletConfiguration(this.options.configurationPath);
    const page = this.extensionPage;
    if (!page || !this.extensionId) throw new Error("Wallet page closed");
    const raw = await readMetaMaskState(page, this.extensionId);
    const state = decodeMetaMaskApprovals(raw);
    return {
      ...state,
      approvals: state.approvals.map((approval) => ({
        ...approval,
        fingerprint: approvalFingerprint(approval),
      })),
    };
  }

  async status(threadId: string, origin = METAMASK_DEFAULT_SITE) {
    await this.connect(threadId);
    const configuration = await readWalletConfiguration(this.options.configurationPath);
    if (
      origin !== METAMASK_DEFAULT_SITE &&
      !configuration.grants.some(
        (grant) =>
          grant.threadId === threadId &&
          grant.origin === origin &&
          Date.parse(grant.expiresAt) > Date.now(),
      )
    )
      throw new MetaMaskError({
        code: "permission_denied",
        detail: "Wallet status requires an allowed website origin.",
      });
    const page = this.pages.get(origin);
    if (!page || page.isClosed())
      throw new MetaMaskError({
        code: "unavailable",
        detail: "Open the wallet website before reading its status.",
      });
    if (new URL(page.url()).origin !== origin)
      throw new MetaMaskError({
        code: "permission_denied",
        detail: "The wallet website navigated away from the allowed origin.",
      });
    const { unlocked } = await this.pending(threadId);
    const raw: unknown = await page.evaluate(`(async () => {
      const origin = ${JSON.stringify(origin)};
      if (location.origin !== origin || !window.ethereum?.isMetaMask) throw new Error('Wallet origin changed or provider unavailable');
      const provider = window.ethereum;
      const chainId = await provider.request({ method: 'eth_chainId' });
      const addresses = await provider.request({ method: 'eth_accounts' });
      const accounts = await Promise.all(addresses.map(async address => ({
        address, balanceWei: await provider.request({ method: 'eth_getBalance', params: [address, 'latest'] }),
      })));
      const currentChain = await provider.request({ method: 'eth_chainId' });
      const currentAccounts = await provider.request({ method: 'eth_accounts' });
      if (location.origin !== origin || provider !== window.ethereum || chainId !== currentChain || JSON.stringify(addresses) !== JSON.stringify(currentAccounts)) throw new Error('Wallet changed while reading status; retry');
      return { origin, chainId, accounts };
    })()`);
    if (new URL(page.url()).origin !== origin)
      throw new MetaMaskError({
        code: "permission_denied",
        detail: "Wallet origin changed while reading status.",
      });
    return decodeWalletStatus({
      ...(typeof raw === "object" && raw !== null ? raw : {}),
      unlocked,
    });
  }

  private journalPath(threadId: string, clientRequestId: string) {
    const id = NodeCrypto.createHash("sha256")
      .update(JSON.stringify([threadId, clientRequestId]))
      .digest("hex");
    return NodePath.join(this.options.journalDirectory, `${id}.json`);
  }

  private async readJournal(path: string) {
    try {
      return decodeJournal(JSON.parse(await NodeFSP.readFile(path, "utf8")));
    } catch (cause) {
      if (typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT")
        return undefined;
      throw cause;
    }
  }

  private async saveJournal(
    path: string,
    fingerprint: string,
    outcome: typeof MetaMaskRequestResult.Type,
  ) {
    await NodeFSP.mkdir(this.options.journalDirectory, { recursive: true });
    const temporary = `${path}.${NodeCrypto.randomUUID()}.tmp`;
    await NodeFSP.writeFile(temporary, JSON.stringify({ fingerprint, outcome }), { mode: 0o600 });
    await NodeFSP.rename(temporary, path);
  }

  async request(threadId: string, input: MetaMaskRequestInput) {
    await this.connect(threadId);
    const configuration = await readWalletConfiguration(this.options.configurationPath);
    requireWalletGrant(configuration.grants, threadId, input, Date.now());
    const parameters = walletRpcParameters(input);
    const path = this.journalPath(threadId, input.clientRequestId);
    const fingerprint = NodeCrypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
    // Reserve synchronously: concurrent MCP retries cannot both dispatch before journal creation.
    const ongoing = this.inFlight.get(path);
    if (ongoing) {
      if (ongoing.fingerprint !== fingerprint)
        throw new MetaMaskError({
          code: "request_failed",
          detail: "This clientRequestId already identifies a different wallet request.",
        });
      await ongoing.start;
      return this.result(threadId, input.clientRequestId);
    }
    const start = this.startRequest(threadId, input, parameters, path, fingerprint);
    this.inFlight.set(path, { fingerprint, start });
    try {
      return await start;
    } finally {
      this.inFlight.delete(path);
    }
  }

  private async startRequest(
    threadId: string,
    input: MetaMaskRequestInput,
    parameters: ReadonlyArray<unknown>,
    path: string,
    fingerprint: string,
  ) {
    const previous = await this.readJournal(path);
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new MetaMaskError({
          code: "request_failed",
          detail: "This clientRequestId already identifies a different wallet request.",
        });
      return this.result(threadId, input.clientRequestId);
    }
    await this.open(threadId, input.origin);
    const page = this.pages.get(input.origin);
    if (!page) throw new Error("Wallet website closed");
    if (new URL(page.url()).origin !== input.origin)
      throw new MetaMaskError({
        code: "permission_denied",
        detail:
          "The wallet website navigated away from the granted origin. Reopen it before requesting wallet access.",
      });
    await page.waitForFunction("() => Boolean(window.ethereum?.isMetaMask)", undefined, {
      timeout: 10000,
    });
    const chainId: unknown = await page.evaluate(
      "window.ethereum.request({method: 'eth_chainId'})",
    );
    if (
      typeof chainId !== "string" ||
      (!["wallet_switchEthereumChain", "wallet_addEthereumChain"].includes(input.method) &&
        BigInt(chainId) !== BigInt(input.chainId))
    ) {
      throw new MetaMaskError({
        code: "permission_denied",
        detail:
          "MetaMask's current chain does not match the grant. Switch chains explicitly first.",
      });
    }
    if (["wallet_switchEthereumChain", "wallet_addEthereumChain"].includes(input.method)) {
      const accounts = decodeAccounts(
        await page.evaluate("window.ethereum.request({method: 'eth_accounts'})"),
      );
      if (!accounts.some((account) => account.toLowerCase() === input.account.toLowerCase()))
        throw new MetaMaskError({
          code: "permission_denied",
          detail: "The granted account is not connected to this website.",
        });
    }
    const outcome = { requestId: input.clientRequestId, status: "pending" as const };
    await this.saveJournal(path, fingerprint, outcome);
    // The journal exists before dispatch. After restart an unfinished call is unknown, never resent.
    this.activeRequests.add(path);
    const completion = page.evaluate(
      `(() => {
      const { origin, request } = ${JSON.stringify({ origin: input.origin, request: { method: input.method, params: parameters } })};
      if (location.origin !== origin || !window.ethereum?.isMetaMask) throw new Error('Wallet origin changed');
      return window.ethereum.request(request);
    })()`,
    );
    const saved = completion
      .then(
        (result: unknown) =>
          this.saveJournal(path, fingerprint, { ...outcome, status: "completed", result }),
        (cause: unknown) =>
          this.saveJournal(path, fingerprint, {
            ...outcome,
            status: "failed",
            error:
              cause instanceof Error
                ? cause.message.slice(0, 1000)
                : "MetaMask rejected the request or the wallet page disconnected. Inspect the wallet before retrying with a new ID.",
          }),
      )
      .catch(() => undefined)
      .finally(() => {
        this.activeRequests.delete(path);
        this.completions.delete(saved);
      });
    this.completions.add(saved);
    return outcome;
  }

  async result(threadId: string, clientRequestId: string) {
    const record = await this.readJournal(this.journalPath(threadId, clientRequestId));
    if (!record)
      throw new MetaMaskError({
        code: "request_failed",
        detail: "No wallet request with this ID exists in this thread.",
      });
    if (
      record.outcome.status === "pending" &&
      !this.activeRequests.has(this.journalPath(threadId, clientRequestId))
    ) {
      return {
        ...record.outcome,
        status: "unknown" as const,
        error:
          "The server lost the live wallet request. Check MetaMask and chain history; this ID will never be dispatched again.",
      };
    }
    return record.outcome;
  }

  async approve(threadId: string, id: string, fingerprint: string) {
    if (this.approving)
      throw new MetaMaskError({
        code: "busy",
        detail: "A wallet confirmation is already being handled.",
      });
    this.approving = true;
    try {
      const { approvals } = await this.pending(threadId);
      const approval = approvals.find((candidate) => candidate.id === id);
      if (!approval || approval.fingerprint !== fingerprint)
        throw new MetaMaskError({
          code: "unsupported_approval",
          detail:
            "The approval changed or is unsupported. Read metamask_pending again or approve manually.",
        });
      const page = this.extensionPage;
      if (!page) throw new Error("Wallet page closed");
      const configuration = await readWalletConfiguration(this.options.configurationPath);
      requireWalletGrant(configuration.grants, threadId, approval, Date.now());
      if (approval.method === "eth_signTypedData_v4")
        walletRpcParameters({ ...approval, clientRequestId: id });
      await page.goto(
        `chrome-extension://${this.extensionId}/home.html#confirmation/${encodeURIComponent(id)}`,
        { waitUntil: "domcontentloaded" },
      );
      const button = page.getByTestId(
        ["wallet_switchEthereumChain", "wallet_addEthereumChain"].includes(approval.method)
          ? "confirmation-submit-button"
          : "confirm-footer-button",
      );
      await button.waitFor({ state: "visible", timeout: 10000 });
      // State, grant and immutable request fingerprint are checked again after the UI has loaded.
      const current = (await this.pending(threadId)).approvals.find(
        (candidate) => candidate.id === id,
      );
      if (!current || current.fingerprint !== fingerprint)
        throw new MetaMaskError({
          code: "unsupported_approval",
          detail: "The wallet confirmation changed while opening it.",
        });
      requireWalletGrant(
        (await readWalletConfiguration(this.options.configurationPath)).grants,
        threadId,
        current,
        Date.now(),
      );
      const clicked = await confirmMetaMaskApproval(page, current);
      if (clicked !== true)
        throw new MetaMaskError({
          code: "unsupported_approval",
          detail: "This confirmation requires manual review in MetaMask.",
        });
      return { approvalId: id, status: "submitted" as const };
    } finally {
      this.approving = false;
    }
  }

  async close(threadId: string) {
    if (this.threadId !== threadId)
      throw new MetaMaskError({
        code: "permission_denied",
        detail: "This wallet session belongs to another thread.",
      });
    await this.context?.close();
    await Promise.allSettled(this.completions);
    return { closed: true };
  }
}
