import type { GameCatalog, GameState } from "@t3tools/contracts";
const escape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
/** A self-contained snapshot: no Unity credentials, live writes or bridge access in generated HTML. */
export function gameReport(catalog: GameCatalog, state: GameState) {
  const watch = state.monitor;
  const rows = catalog.hooks
    .map((hook) => {
      const samples = watch?.samples.filter((s) => hook.handle in s.values) ?? [];
      const traces = Array.from({ length: hook.components ?? 1 }, (_, axis) => {
        const points = samples.flatMap((sample) => {
          const raw = sample.values[hook.handle];
          const value = Array.isArray(raw) ? raw[axis] : raw;
          return typeof value === "number" ? [{ time: sample.sampledAtMs, value }] : [];
        });
        if (!points.length) return "";
        const min = Math.min(...points.map((p) => p.value));
        const max = Math.max(...points.map((p) => p.value));
        const first = points[0]!.time,
          last = points.at(-1)!.time;
        const line = points
          .map(
            (p) =>
              `${(((p.time - first) / Math.max(1, last - first)) * 300).toFixed(2)},${(55 - ((p.value - min) / Math.max(0.001, max - min)) * 50).toFixed(2)}`,
          )
          .join(" ");
        return `<polyline points="${line}" fill="none" stroke="${["#91ceff", "#ffc17d", "#a1e6a1", "#e3a7ff"][axis]}" stroke-width="2"/>`;
      }).join("");
      const latest = samples.at(-1)?.values[hook.handle];
      return `<tr><th>${escape(hook.key)}</th><td>${escape(Array.isArray(latest) ? JSON.stringify(latest) : String(latest ?? "No samples"))} ${escape(hook.unit ?? "")}</td><td>${traces ? `<svg viewBox="0 0 300 60" role="img" aria-label="Sample history">${traces}</svg>${hook.type === "vector" ? "<small>X blue · Y orange · Z green · W purple (each axis scaled)</small>" : ""}` : "—"}</td></tr>`;
    })
    .join("");
  const runtime = catalog.evidence;
  const context = runtime
    ? `<p>Host: ${escape(runtime.host)} · ${escape(runtime.platform)}<br>Unity ${escape(runtime.unityVersion)} · ${escape(runtime.product)} ${escape(runtime.version)}<br>Build: ${escape(runtime.buildGuid || "Editor / unbuilt")} · Scene: ${escape(runtime.scene)}</p>`
    : "";
  const evidence = JSON.stringify({ schema: "t3.unity-evidence/v1", catalog, state }, null, 2);
  const receipts = (watch?.receipts ?? [])
    .map(
      (receipt) =>
        `<tr><td>${escape(receipt.id)}</td><td>${receipt.arm}</td><td>${receipt.sample.sequence}</td><td>${escape(JSON.stringify(receipt.sample.values))}</td></tr>`,
    )
    .join("");
  const mutations = (watch?.samples ?? [])
    .flatMap((sample) => {
      const mutation = sample.mutation;
      if (!mutation) return [];
      const key =
        catalog.hooks.find((hook) => hook.handle === mutation.handle)?.key ?? mutation.handle;
      return [
        `<tr><td>${sample.sequence}</td><td>${escape(key)}</td><td>${escape(JSON.stringify(mutation.before))}</td><td>${escape(JSON.stringify(mutation.requested))}</td><td>${escape(JSON.stringify(sample.values[mutation.handle]))}</td><td>${escape(mutation.outcome)}</td></tr>`,
      ];
    })
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px system-ui;color:var(--foreground,#ddd);background:var(--background,#171b22);padding:16px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #666}svg{width:100%;min-width:130px;max-width:300px}p{line-height:1.6;overflow-wrap:anywhere}</style></head><body><h2>Unity gameplay observations</h2>${context}<p>${escape(catalog.target)} · generation ${escape(catalog.generation)}<br>Watch: ${escape(watch?.status ?? "not started")} · retained ${watch?.samples.length ?? 0} samples · dropped ${watch?.dropped ?? 0}</p><table><thead><tr><th>Variable</th><th>Latest value</th><th>History</th></tr></thead><tbody>${rows}</tbody></table><h3>Predicate receipts</h3><p>${escape(JSON.stringify(watch?.predicate ?? null))} · ${watch?.armed ? "armed" : "not armed"}</p><table><thead><tr><th>Receipt</th><th>Arm</th><th>Sequence</th><th>Observed</th></tr></thead><tbody>${receipts}</tbody></table><h3>Mutations</h3><table><thead><tr><th>Sequence</th><th>Variable</th><th>Before</th><th>Requested</th><th>Observed</th><th>Outcome</th></tr></thead><tbody>${mutations}</tbody></table><details><summary>Underlying evidence (JSON)</summary><pre>${escape(evidence)}</pre></details><p>This report is a bounded snapshot of simulation observations, not a live monitor. Missing samples are gaps. Times are relative to this target’s monotonic clock.</p></body></html>`;
}
