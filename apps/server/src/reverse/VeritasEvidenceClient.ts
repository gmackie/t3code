import {
  type ReverseFindingRecord,
  type ReverseFirmwareArtifact,
  type ReverseFirmwareSource,
  ReverseStoreError,
} from "@t3tools/contracts";

// Messages here are written for the user and carry no host paths, so they reach clients as-is.
const veritasError = (message: string) =>
  new ReverseStoreError({ reason: "operation_failed", message });

export interface VeritasEvidenceConnection {
  readonly url: string;
  readonly token: string;
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
// Acknowledgements are small; read queries can list a whole organization's records.
const MAX_MUTATION_RESPONSE_BYTES = 256 * 1024;
const MAX_QUERY_RESPONSE_BYTES = 4 * 1024 * 1024;

async function readBounded(response: Response, maxBytes: number): Promise<Record<string, unknown>> {
  const declared = Number(response.headers.get("content-length"));
  if (declared > maxBytes) throw veritasError("Oversized Veritas response.");
  const reader = response.body?.getReader();
  if (!reader) throw veritasError("Empty Veritas response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw veritasError("Oversized Veritas response.");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return record(JSON.parse(new TextDecoder().decode(bytes)));
}

/**
 * Environment-owned credentials never cross the renderer boundary. Every call is a tRPC mutation
 * that is never retried automatically, so an uncertain outcome is reported rather than repeated.
 */
export class VeritasEvidenceClient {
  private readonly connection: VeritasEvidenceConnection | null;
  private readonly fetcher: typeof fetch;
  constructor(connection: VeritasEvidenceConnection | null, fetcher: typeof fetch = fetch) {
    this.connection = connection;
    this.fetcher = fetcher;
  }
  get configured(): boolean {
    return this.connection !== null;
  }

  private mutate(procedure: string, input: unknown) {
    return this.call("POST", procedure, input);
  }

  /** Runs a read-only query; tRPC takes query input in the URL. */
  query(procedure: string, input: unknown) {
    return this.call("GET", procedure, input);
  }

  /** Calls one procedure and returns its `json` result, or throws Veritas's own explanation. */
  private async call(
    method: "GET" | "POST",
    procedure: string,
    input: unknown,
  ): Promise<Record<string, unknown>> {
    if (!this.connection)
      throw new ReverseStoreError({
        reason: "unavailable",
        message: "Configure VERITAS_URL and VERITAS_API_TOKEN on the environment server.",
      });
    const base = new URL(this.connection.url);
    if (
      !["https:", "http:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw veritasError("Invalid Veritas server URL.");
    // The bearer token only travels in cleartext to this machine.
    if (base.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
      throw veritasError("Veritas requires HTTPS unless it runs on this machine.");
    const endpoint = new URL(`${base.toString().replace(/\/$/, "")}/api/trpc/${procedure}`);
    if (method === "GET") endpoint.searchParams.set("input", JSON.stringify({ json: input }));
    const response = await this.fetcher(endpoint, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `Bearer ${this.connection.token}`,
        "content-type": "application/json",
      },
      ...(method === "POST" ? { body: JSON.stringify({ json: input }) } : {}),
    });
    const payload: Record<string, unknown> = await readBounded(
      response,
      method === "GET" ? MAX_QUERY_RESPONSE_BYTES : MAX_MUTATION_RESPONSE_BYTES,
    ).catch((cause: unknown) => {
      if (response.ok) throw cause;
      return {};
    });
    if (!response.ok || payload.error) {
      // Client errors carry a message Veritas wrote for the caller, such as which field conflicts.
      // Server errors can carry query text, so those stay generic.
      const message = record(record(payload.error).json).message;
      const forCaller = response.status >= 400 && response.status < 500;
      throw veritasError(
        forCaller && typeof message === "string" && message.length <= 2000
          ? `Veritas: ${message}`
          : `Veritas rejected ${procedure} (${response.status}). No automatic retry was attempted.`,
      );
    }
    return record(record(record(payload.result).data).json);
  }

  async register(
    artifact: ReverseFirmwareArtifact,
    boardRevisionId?: string,
    source: ReverseFirmwareSource = "imported",
  ): Promise<{ id: string; sha256: string }> {
    const data = await this.mutate("reFirmware.register", {
      // Extracted firmware is registered against its parent, which Veritas must know first.
      identity: artifact.parentSha256
        ? {
            sha256: artifact.sha256,
            sizeBytes: String(artifact.sizeBytes),
            source: "extracted",
            parentSha256: artifact.parentSha256,
          }
        : { sha256: artifact.sha256, sizeBytes: String(artifact.sizeBytes), source },
      ...(boardRevisionId ? { boardRevisionId } : {}),
    });
    const remote = record(data.artifact);
    if (
      typeof remote.id !== "string" ||
      remote.sha256 !== artifact.sha256 ||
      String(remote.sizeBytes) !== String(artifact.sizeBytes)
    )
      throw veritasError("Veritas returned mismatched artifact identity.");
    return { id: remote.id, sha256: artifact.sha256 };
  }

  /** Sets or, with null, clears the board revision a registered artifact belongs to. */
  async linkBoardRevision(sha256: string, boardRevisionId: string | null): Promise<void> {
    const data = await this.mutate("reFirmware.linkBoardRevision", { sha256, boardRevisionId });
    if (record(data.artifact).sha256 !== sha256)
      throw veritasError("Veritas returned mismatched artifact identity.");
  }

  /** Records a QEMU observation under the run id T3 assigned it; re-recording is idempotent. */
  async recordEmulation(input: {
    artifactSha256: string;
    runId: string;
    outcome: "pass" | "fail" | "error" | "inconclusive";
  }): Promise<void> {
    const data = await this.mutate("reFirmware.recordExperiment", {
      artifactSha256: input.artifactSha256,
      source: "qemu",
      outcome: input.outcome,
      runId: input.runId,
      evidence: [],
    });
    if (record(data.experiment).runId !== input.runId)
      throw veritasError("Veritas returned a different experiment.");
  }

  /** Publishes a finding as a candidate; people confirm it in Veritas. */
  async createFinding(finding: ReverseFindingRecord): Promise<{ id: string }> {
    const data = await this.mutate("reFirmware.createFinding", {
      artifactSha256: finding.artifactSha256,
      title: finding.title,
      kind: finding.kind,
      status: "candidate",
      authorKind: finding.authorKind,
      evidence: finding.evidence,
      // Lets Veritas return the existing finding when a timed-out publish is retried.
      externalId: finding.id,
    });
    const id = record(data.finding).id;
    if (typeof id !== "string") throw veritasError("Veritas returned no finding id.");
    return { id };
  }
}
