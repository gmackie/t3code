import { useCallback, useEffect, useRef, useState } from "react";
import * as Schema from "effect/Schema";
import {
  VeritasCadStatus,
  type VeritasCadAction,
  type KiCadProjectManifest,
} from "@t3tools/contracts";

const decodeStatus = Schema.decodeUnknownSync(VeritasCadStatus);

const buttonClass =
  "rounded border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-50";
const inputClass = "w-full rounded border border-border bg-background px-2 py-1.5 text-sm";

export function VeritasView({
  endpoint,
  manifest,
  assetUrl,
}: {
  endpoint: string;
  manifest: KiCadProjectManifest;
  assetUrl: (path: string) => string;
}) {
  const [status, setStatus] = useState<VeritasCadStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [boards, setBoards] = useState(1);
  const [route, setRoute] = useState<"turnkey" | "lumen-pnp" | "hand">("hand");
  const [fab, setFab] = useState({
    layers: 2,
    widthMm: 0,
    heightMm: 0,
    finish: "hasl" as "hasl" | "enig",
  });
  const validFab =
    Number.isInteger(fab.layers) &&
    fab.layers >= 1 &&
    fab.layers <= 32 &&
    [fab.widthMm, fab.heightMm].every(
      (value) => Number.isFinite(value) && value >= 0.1 && value <= 2000,
    );
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const request = useCallback(
    async (action?: VeritasCadAction) => {
      const current = ++generation.current;
      controller.current?.abort();
      controller.current = new AbortController();
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(endpoint, {
          method: action ? "POST" : "GET",
          cache: "no-store",
          signal: controller.current.signal,
          ...(action
            ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) }
            : {}),
        });
        const value: unknown = await response.json();
        if (!response.ok) {
          const message =
            value &&
            typeof value === "object" &&
            "error" in value &&
            typeof value.error === "string"
              ? value.error
              : "Unable to load Veritas. Reopen CAD if viewer access expired.";
          throw new Error(message);
        }
        const next = decodeStatus(value);
        if (generation.current === current) setStatus(next);
      } catch (cause) {
        if (generation.current === current && !controller.current?.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Unable to reach Veritas.");
      } finally {
        if (generation.current === current) setBusy(false);
      }
    },
    [endpoint],
  );
  useEffect(() => {
    void request();
    return () => {
      ++generation.current;
      controller.current?.abort();
    };
  }, [request]);
  const linkedReviewCurrent = status?.link.snapshotRevision === manifest.revision;
  const canOperate = Boolean(
    status?.configured && status.canOperate && !status.link.pendingOperation && !busy,
  );
  return (
    <div className="h-full overflow-auto p-4 text-sm">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Veritas</h2>
            <p className="text-xs text-muted-foreground">
              Design snapshots, sourced parts, review evidence, and production.
            </p>
          </div>
          <button className={buttonClass} disabled={busy} onClick={() => void request()}>
            {busy ? "Working…" : "Refresh status"}
          </button>
        </div>
        {error && (
          <p className="rounded border border-destructive p-3 text-destructive" role="alert">
            {error}
          </p>
        )}
        {status?.remoteError && (
          <p role="alert" className="rounded border border-border p-3">
            {status.remoteError}
          </p>
        )}
        {status && !status.configured && (
          <p className="rounded border border-border p-3">
            Connect this environment by setting <code>VERITAS_URL</code> and{" "}
            <code>VERITAS_API_TOKEN</code> on its T3 server, then restart that server. Use a Veritas
            service token with design review access.
          </p>
        )}
        {status?.link.pendingOperation && (
          <p className="rounded border border-border p-3" role="status">
            A {status.link.pendingOperation} submission has an uncertain outcome. Check Veritas,
            then link the resulting review or production run below. Refreshing will not submit it
            again.
          </p>
        )}
        <section className="space-y-2">
          <h3 className="font-medium">Design</h3>
          <p className="text-xs text-muted-foreground">
            {manifest.files.length} saved CAD files in this workspace. Review sends an immutable ZIP
            snapshot; subsequent edits stay local until a new review.
          </p>
          <details>
            <summary className="cursor-pointer text-xs">Saved design files</summary>
            <ul className="mt-2 max-h-44 space-y-1 overflow-auto text-xs">
              {manifest.files.map((file) => (
                <li key={file.path}>
                  <a
                    className="underline"
                    href={assetUrl(file.path)}
                    download
                    referrerPolicy="no-referrer"
                  >
                    {file.path}
                  </a>
                </li>
              ))}
            </ul>
          </details>
          {status?.link.snapshotSha256 && (
            <p className="break-all font-mono text-[10px] text-muted-foreground">
              Submitted snapshot SHA-256: {status.link.snapshotSha256}
            </p>
          )}
          <button
            className={buttonClass}
            disabled={!canOperate || !status?.canShareSnapshot || linkedReviewCurrent}
            onClick={() => void request({ type: "review", revision: manifest.revision })}
          >
            {linkedReviewCurrent ? "This snapshot has a review" : "Send saved design for review"}
          </button>
          {status?.configured && !status.canShareSnapshot && (
            <p className="text-xs text-muted-foreground">
              Set <code>VERITAS_CAD_PUBLIC_URL</code> to this T3 server’s address reachable by the
              Veritas review agent. Snapshot access expires after 30 minutes.
            </p>
          )}
        </section>
        <section className="space-y-2">
          <h3 className="font-medium">Review</h3>
          {status?.review ? (
            <>
              <p>
                {status.review.status}{" "}
                <span className="text-xs text-muted-foreground">· {status.review.id}</span>
              </p>
              {!linkedReviewCurrent && status.link.snapshotRevision && (
                <p className="text-xs text-muted-foreground">
                  The saved design has changed since this review.
                </p>
              )}
              {status.review.error && <p role="alert">{status.review.error}</p>}
              {status.review.signedBundleUrl && (
                <a
                  className="text-xs underline"
                  href={status.review.signedBundleUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open signed evidence bundle
                </a>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Send a snapshot or link an existing Veritas review.
            </p>
          )}
        </section>
        <section className="space-y-2">
          <h3 className="font-medium">Parts and BOM</h3>
          {status?.bom.length ? (
            <div className="overflow-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    {["References", "Part", "Value / footprint", "Stock", "Unit price"].map(
                      (label) => (
                        <th className="border-b border-border p-2 font-medium" key={label}>
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {status.bom.map((line) => (
                    <tr key={line.id}>
                      <td className="border-b border-border p-2">{line.refdesList.join(", ")}</td>
                      <td className="border-b border-border p-2">
                        {line.partNumber ?? "Unresolved"}
                        <div className="text-muted-foreground">
                          {line.manufacturer} {line.lcscNumber}
                        </div>
                        {line.flags.length > 0 && <div>{line.flags.join(" · ")}</div>}
                      </td>
                      <td className="border-b border-border p-2">
                        {line.value}
                        <div className="text-muted-foreground">{line.footprint}</div>
                      </td>
                      <td className="border-b border-border p-2">
                        {line.inStock ?? "Unknown"}
                        {line.eol && line.eol !== "active" ? ` · ${line.eol}` : ""}
                      </td>
                      <td className="border-b border-border p-2">
                        {line.unitPriceMicrousd === null
                          ? "Unknown"
                          : `$${(line.unitPriceMicrousd / 1_000_000).toFixed(4)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Veritas publishes sourced parts here after processing the review.
            </p>
          )}
        </section>
        {status && status.bom.length >= 500 && (
          <p role="status" className="text-xs text-muted-foreground">
            Veritas returned its 500-line BOM limit. This may be an incomplete BOM; prepare
            production in Veritas after confirming all parts.
          </p>
        )}
        <section className="space-y-2">
          <h3 className="font-medium">Manufacturing</h3>
          {status?.production ? (
            <>
              <p>
                {status.production.name} · {status.production.state} · {status.production.boards}{" "}
                boards
              </p>
              <ul className="space-y-1 text-xs">
                {status.production.orders.map((order) => (
                  <li key={order.id}>
                    {order.kind} · {order.vendor} · {order.status}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Prepare fabrication, parts, and assembly work from the reviewed BOM. Enter the saved
                board’s dimensions and layer count for fabrication estimates. Orders are placed
                separately in Veritas’s vendor workflow.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-xs">
                  Boards
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={boards}
                    className={inputClass}
                    onChange={(event) => setBoards(event.currentTarget.valueAsNumber)}
                  />
                </label>
                <label className="space-y-1 text-xs">
                  Assembly
                  <select
                    className={inputClass}
                    value={route}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "hand" || value === "turnkey" || value === "lumen-pnp")
                        setRoute(value);
                    }}
                  >
                    <option value="hand">Hand assembly</option>
                    <option value="turnkey">Turnkey</option>
                    <option value="lumen-pnp">Lumen pick and place</option>
                  </select>
                </label>
                {(
                  [
                    ["widthMm", "Width (mm)"],
                    ["heightMm", "Height (mm)"],
                    ["layers", "Copper layers"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="space-y-1 text-xs">
                    {label}
                    <input
                      type="number"
                      className={inputClass}
                      min={key === "layers" ? 1 : 0.1}
                      max={key === "layers" ? 32 : 2000}
                      step={key === "layers" ? 1 : "any"}
                      value={fab[key] || ""}
                      onChange={(event) =>
                        setFab({ ...fab, [key]: event.currentTarget.valueAsNumber })
                      }
                    />
                  </label>
                ))}
                <label className="space-y-1 text-xs">
                  Finish
                  <select
                    className={inputClass}
                    value={fab.finish}
                    onChange={(event) => {
                      const finish = event.currentTarget.value;
                      if (finish === "hasl" || finish === "enig") setFab({ ...fab, finish });
                    }}
                  >
                    <option value="hasl">HASL</option>
                    <option value="enig">ENIG</option>
                  </select>
                </label>
                <button
                  className={buttonClass}
                  disabled={
                    !validFab ||
                    (status?.bom.length ?? 0) >= 500 ||
                    !canOperate ||
                    status?.review?.status !== "complete" ||
                    !status.bom.length ||
                    !Number.isInteger(boards) ||
                    boards < 1 ||
                    boards > 10000
                  }
                  onClick={() => {
                    if (status?.link.reviewId)
                      void request({
                        type: "production",
                        reviewId: status.link.reviewId,
                        boards,
                        route,
                        fab,
                      });
                  }}
                >
                  Prepare production run
                </button>
              </div>
            </>
          )}
        </section>
        {status?.canOperate && (
          <details className="border-t border-border pt-3">
            <summary className="cursor-pointer text-xs">Link an existing Veritas project</summary>
            <form
              className="mt-3 space-y-3"
              key={`${status.link.projectId}:${status.link.reviewId}:${status.link.productionRunId}`}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const field = (name: string) => String(data.get(name) ?? "").trim() || null;
                void request({
                  type: "link",
                  projectId: field("projectId"),
                  reviewId: field("reviewId"),
                  productionRunId: field("productionRunId"),
                });
              }}
            >
              {[
                ["projectId", "Project ID", status.link.projectId],
                ["reviewId", "Review ID", status.link.reviewId],
                ["productionRunId", "Production run ID", status.link.productionRunId],
              ].map(([name, label, value]) => (
                <label className="block space-y-1 text-xs" key={name}>
                  {label}
                  <input className={inputClass} name={name ?? ""} defaultValue={value ?? ""} />
                </label>
              ))}
              <div className="flex gap-2">
                <button className={buttonClass} disabled={busy || !status.configured}>
                  Save connection
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => void request({ type: "unlink" })}
                >
                  Unlink workspace
                </button>
              </div>
            </form>
          </details>
        )}
      </div>
    </div>
  );
}
