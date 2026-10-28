import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PrismGerberView } from "./PrismGerberView";
import { gerberPresetPaths, type GerberPreset } from "./gerberPresets";
import { useEnvironmentQuery } from "../state/query";
import { gerberSvgQuery } from "./query";

const presets = [
  ["layer", "Single layer"],
  ["copper", "Copper layers"],
  ["front", "Front placement"],
  ["back", "Back placement"],
  ["all", "All layers"],
] as const;

export function GerberBrowser({
  paths,
  selected,
  revision,
  onSelect,
  url,
  read,
}: {
  paths: string[];
  selected: string;
  revision: string;
  onSelect: (path: string) => void;
  url: (paths: string[]) => string;
  read: (url: string, signal: AbortSignal) => Promise<Response>;
}) {
  const [preset, setPreset] = useState<GerberPreset>("layer");
  const chosen = gerberPresetPaths(paths, selected, preset);
  const index = paths.indexOf(selected);
  const step = (direction: number) => {
    const path = paths[(index + direction + paths.length) % paths.length];
    if (path) onSelect(path);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Bind Gerber layer navigation keys while this browser is mounted and release the window listener on teardown.
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input,select,textarea,button")
      )
        return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        step(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [selected, paths]);
  const renderUrl = chosen.length ? url(chosen) : null;
  const adjacentUrls =
    preset === "layer"
      ? [1, -1].flatMap((offset) => {
          const next = paths[(index + offset + paths.length) % paths.length];
          return next ? [url(gerberPresetPaths(paths, next, "layer"))] : [];
        })
      : [];
  const svg = useEnvironmentQuery(
    renderUrl === null
      ? null
      : gerberSvgQuery(read, { url: renderUrl, revision, adjacent: adjacentUrls }),
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1 text-xs">
        <button
          type="button"
          className="kicad-icon-button"
          aria-label="Previous Gerber layer"
          onClick={() => step(-1)}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="shrink-0 text-muted-foreground">
          {index + 1} / {paths.length}
        </span>
        <button
          type="button"
          className="kicad-icon-button"
          aria-label="Next Gerber layer"
          onClick={() => step(1)}
        >
          <ChevronRight size={14} />
        </button>
        <select
          aria-label="Gerber inspection preset"
          value={preset}
          onChange={(event) => setPreset(event.target.value as GerberPreset)}
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
        >
          {presets.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="relative min-h-0 flex-1">
        <PrismGerberView svg={svg.data ?? ""} label={chosen.join(", ")} />
        {(svg.error || !chosen.length || svg.data === null) && (
          <div
            role="status"
            className="absolute inset-0 flex items-center justify-center bg-background/90 p-4 text-center text-xs text-muted-foreground"
          >
            {svg.error ||
              (!chosen.length ? "No matching layers in this fabrication set." : "Loading layers…")}
          </div>
        )}
      </div>
    </div>
  );
}
