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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:14px system-ui;color:var(--foreground,#ddd);background:var(--background,#171b22);padding:16px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #666}svg{width:100%;min-width:130px;max-width:300px}p{line-height:1.6;overflow-wrap:anywhere}</style></head><body><h2>Unity gameplay observations</h2><p>${escape(catalog.target)} · generation ${escape(catalog.generation)}<br>Watch: ${escape(watch?.status ?? "not started")} · retained ${watch?.samples.length ?? 0} samples · dropped ${watch?.dropped ?? 0}</p><table><thead><tr><th>Variable</th><th>Latest value</th><th>History</th></tr></thead><tbody>${rows}</tbody></table><p>This report is a bounded snapshot of simulation observations, not a live monitor. Missing samples are gaps. Times are relative to this target’s monotonic clock.</p></body></html>`;
}
