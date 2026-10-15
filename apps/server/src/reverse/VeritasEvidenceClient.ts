import type { ReverseFirmwareArtifact } from "@t3tools/contracts";

export interface VeritasEvidenceConnection {
  readonly url: string;
  readonly token: string;
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Environment-owned credentials never cross the renderer boundary. Registration is digest-idempotent. */
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

  async register(
    artifact: ReverseFirmwareArtifact,
    boardRevisionId?: string,
  ): Promise<{ id: string; sha256: string }> {
    if (!this.connection)
      throw new Error("Configure VERITAS_URL and VERITAS_API_TOKEN on the environment server.");
    const base = new URL(this.connection.url);
    if (
      !["https:", "http:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash
    )
      throw new Error("Invalid Veritas server URL.");
    const endpoint = new URL(`${base.toString().replace(/\/$/, "")}/api/trpc/reFirmware.register`);
    const response = await this.fetcher(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        authorization: `Bearer ${this.connection.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        json: {
          identity: {
            sha256: artifact.sha256,
            sizeBytes: String(artifact.sizeBytes),
            source: "imported",
          },
          ...(boardRevisionId ? { boardRevisionId } : {}),
        },
      }),
    });
    if (!response.ok)
      throw new Error(
        `Veritas rejected firmware registration (${response.status}). No automatic mutation retry was attempted.`,
      );
    const declared = Number(response.headers.get("content-length"));
    if (declared > 256 * 1024) throw new Error("Oversized Veritas response.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Veritas response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 256 * 1024) throw new Error("Oversized Veritas response.");
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
    const payload = record(JSON.parse(new TextDecoder().decode(bytes)));
    if (payload.error) throw new Error("Veritas rejected firmware registration.");
    const data = record(record(record(payload.result).data).json);
    const remote = record(data.artifact);
    if (
      typeof remote.id !== "string" ||
      remote.sha256 !== artifact.sha256 ||
      String(remote.sizeBytes) !== String(artifact.sizeBytes)
    )
      throw new Error("Veritas returned mismatched artifact identity.");
    return { id: remote.id, sha256: artifact.sha256 };
  }
}
