import { useEffect, useRef, useState } from "react";
import type {
  ReverseCapture,
  ReverseCaptureDecodeResult,
  ReverseCaptureDecoder,
  ReverseCaptureViewResult,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { reverseEnvironment } from "~/state/reverse";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { CaptureCitation } from "./FindingsPanel";

const ROW_HEIGHT = 22;
const LABEL_WIDTH = 96;

/** Formats nanoseconds at a precision that suits the value. */
export function formatNs(ns: number): string {
  const abs = Math.abs(ns);
  if (abs >= 1e9) return `${(ns / 1e9).toFixed(3)} s`;
  if (abs >= 1e6) return `${(ns / 1e6).toFixed(3)} ms`;
  if (abs >= 1e3) return `${(ns / 1e3).toFixed(2)} µs`;
  return `${Math.round(ns)} ns`;
}

const themeColor = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Draws a window once; the canvas only repaints when the window or its size changes. */
function drawWindow(
  canvas: HTMLCanvasElement,
  view: ReverseCaptureViewResult,
  cursorNs: number | null,
) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = view.channels.length * ROW_HEIGHT + 4;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.style.height = `${height}px`;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  const foreground = themeColor("--foreground", "#222");
  const muted = themeColor("--muted-foreground", "#888");
  const accent = themeColor("--chart-1", "#3b82f6");
  const plot = width - LABEL_WIDTH;
  const span = view.endNs - view.startNs;
  const x = (ns: number) => LABEL_WIDTH + ((ns - view.startNs) / span) * plot;
  context.font = "11px ui-monospace, monospace";
  view.channels.forEach((channel, row) => {
    const top = row * ROW_HEIGHT + 4;
    const high = top + 3,
      low = top + ROW_HEIGHT - 5;
    context.fillStyle = muted;
    context.fillText(channel.name.slice(0, 13), 2, low);
    context.strokeStyle = accent;
    context.fillStyle = accent;
    if (channel.busy) {
      // Too many edges to draw: shade where the signal toggles.
      context.globalAlpha = 0.35;
      for (const [start, end] of channel.busy)
        context.fillRect(x(start), high, Math.max(1, x(end) - x(start)), low - high);
      context.globalAlpha = 1;
      return;
    }
    let level = channel.level;
    context.beginPath();
    context.moveTo(LABEL_WIDTH, level ? high : low);
    for (const edge of channel.edges ?? []) {
      context.lineTo(x(edge), level ? high : low);
      level = level ? 0 : 1;
      context.lineTo(x(edge), level ? high : low);
    }
    context.lineTo(width, level ? high : low);
    context.stroke();
  });
  if (cursorNs !== null && cursorNs >= view.startNs && cursorNs <= view.endNs) {
    context.strokeStyle = foreground;
    context.beginPath();
    context.moveTo(x(cursorNs), 0);
    context.lineTo(x(cursorNs), height);
    context.stroke();
  }
}

type Protocol = ReverseCaptureDecoder["protocol"];

export function CapturesPanel({
  threadRef,
  projectId,
  captures,
  canCite,
  onChanged,
  onCite,
}: {
  threadRef: ScopedThreadRef;
  projectId: string;
  captures: ReadonlyArray<ReverseCapture>;
  /** Citing needs an investigation to attach the finding to. */
  canCite: boolean;
  onChanged: () => void;
  onCite: (citation: CaptureCitation) => void;
}) {
  const importCapture = useAtomCommand(reverseEnvironment.importCapture, { reportFailure: false });
  const viewCapture = useAtomCommand(reverseEnvironment.viewCapture, { reportFailure: false });
  const decodeCapture = useAtomCommand(reverseEnvironment.decodeCapture, { reportFailure: false });
  const removeCapture = useAtomCommand(reverseEnvironment.removeCapture, { reportFailure: false });
  const [path, setPath] = useState(""),
    [selectedId, setSelectedId] = useState<string | null>(null),
    [confirmDelete, setConfirmDelete] = useState(false);
  const [range, setRange] = useState<{ startNs: number; endNs: number } | null>(null),
    [view, setView] = useState<ReverseCaptureViewResult | null>(null),
    [cursorNs, setCursorNs] = useState<number | null>(null);
  const [protocol, setProtocol] = useState<Protocol>("uart"),
    [lines, setLines] = useState<Record<string, string>>({}),
    [baud, setBaud] = useState("115200"),
    [decoded, setDecoded] = useState<ReverseCaptureDecodeResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const alive = useRef(true),
    request = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const selected = captures.find((capture) => capture.id === selectedId) ?? null;
  const shown =
    selected && range
      ? range
      : selected
        ? { startNs: 0, endNs: Math.max(1, selected.durationNs) }
        : null;

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  // Fetch the visible window whenever the capture or range changes.
  const captureId = selected?.id ?? null;
  const startNs = shown?.startNs ?? 0;
  const endNs = shown?.endNs ?? 0;
  const environmentId = threadRef.environmentId;
  useEffect(() => {
    if (!captureId || !canvas.current) return;
    const sequence = ++request.current;
    const maxPoints = Math.max(
      10,
      Math.min(4000, Math.floor(canvas.current.clientWidth - LABEL_WIDTH)),
    );
    void viewCapture({
      environmentId,
      input: { projectId, captureId, startNs, endNs, maxPoints },
    }).then((response) => {
      if (!alive.current || sequence !== request.current) return;
      if (response._tag === "Failure") setError(String(squashAtomCommandFailure(response)));
      else setView(response.value);
    });
  }, [captureId, startNs, endNs, projectId, environmentId, viewCapture]);

  useEffect(() => {
    if (view && canvas.current) drawWindow(canvas.current, view, cursorNs);
  }, [view, cursorNs]);

  const zoom = (factor: number, centerNs?: number) => {
    if (!selected || !shown) return;
    const center = centerNs ?? (shown.startNs + shown.endNs) / 2;
    const half = Math.max(50, ((shown.endNs - shown.startNs) * factor) / 2);
    const startNs = Math.max(0, center - half);
    setRange({ startNs, endNs: startNs + 2 * half });
  };
  const pan = (fraction: number) => {
    if (!shown || !selected) return;
    const delta = (shown.endNs - shown.startNs) * fraction;
    const startNs = Math.max(0, shown.startNs + delta);
    setRange({ startNs, endNs: startNs + (shown.endNs - shown.startNs) });
  };
  const timeAt = (clientX: number) => {
    if (!canvas.current || !shown) return null;
    const box = canvas.current.getBoundingClientRect();
    const plot = box.width - LABEL_WIDTH;
    const fraction = (clientX - box.left - LABEL_WIDTH) / plot;
    return fraction < 0 ? null : shown.startNs + fraction * (shown.endNs - shown.startNs);
  };

  const decoderFor = (): ReverseCaptureDecoder | null => {
    const line = (name: string) => lines[name] || undefined;
    if (protocol === "uart") {
      const signal = line("signal");
      const rate = Number(baud);
      return signal && Number.isInteger(rate) && rate > 0 ? { protocol, signal, baud: rate } : null;
    }
    if (protocol === "spi") {
      const clk = line("clk");
      if (!clk || (!line("mosi") && !line("miso"))) return null;
      return {
        protocol,
        clk,
        ...(line("mosi") ? { mosi: line("mosi")! } : {}),
        ...(line("miso") ? { miso: line("miso")! } : {}),
        ...(line("cs") ? { cs: line("cs")! } : {}),
      };
    }
    const sda = line("sda"),
      scl = line("scl");
    return sda && scl ? { protocol, sda, scl } : null;
  };
  const LINES: Record<Protocol, string[]> = {
    uart: ["signal"],
    spi: ["clk", "mosi", "miso", "cs"],
    i2c: ["sda", "scl"],
  };

  return (
    <section aria-label="Captures" className="space-y-2 border-t border-border p-3">
      <h3 className="text-xs font-medium">Captures</h3>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const response = await importCapture({
              environmentId: threadRef.environmentId,
              input: { projectId, relativePath: path.trim() },
            });
            if (response._tag === "Failure") throw squashAtomCommandFailure(response);
            if (!alive.current) return;
            setPath("");
            setSelectedId(response.value.id);
            setRange(null);
            onChanged();
          });
        }}
      >
        <Input
          aria-label="Capture path relative to the project"
          placeholder="capture.vcd, session.sr, digital.csv…"
          value={path}
          onChange={(event) => setPath(event.target.value)}
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !path.trim()}>
          Import capture
        </Button>
      </form>
      {captures.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {captures.map((capture) => (
            <Button
              key={capture.id}
              size="xs"
              variant={capture.id === selectedId ? "secondary" : "ghost"}
              onClick={() => {
                setSelectedId(capture.id);
                setRange(null);
                setView(null);
                setDecoded(null);
                setCursorNs(null);
                setConfirmDelete(false);
              }}
            >
              {capture.filename}
            </Button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {selected && shown && (
        <div className="space-y-2 text-xs">
          <p className="text-muted-foreground">
            {selected.format} · {selected.channels.length} channels ·{" "}
            {formatNs(selected.durationNs)}
            {selected.sampleRateHz ? ` · ${selected.sampleRateHz / 1e6} MS/s` : ""}
            {selected.truncated ? " · only the start was kept" : ""}
            {selected.skipped.length ? ` · skipped ${selected.skipped.join(", ")}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            <Button size="xs" variant="outline" onClick={() => zoom(0.5, cursorNs ?? undefined)}>
              Zoom in
            </Button>
            <Button size="xs" variant="outline" onClick={() => zoom(2, cursorNs ?? undefined)}>
              Zoom out
            </Button>
            <Button size="xs" variant="outline" onClick={() => setRange(null)}>
              Fit
            </Button>
            <Button size="xs" variant="outline" onClick={() => pan(-0.5)}>
              ←
            </Button>
            <Button size="xs" variant="outline" onClick={() => pan(0.5)}>
              →
            </Button>
            <span className="text-muted-foreground">
              {formatNs(shown.startNs)} – {formatNs(shown.endNs)}
              {cursorNs !== null ? ` · cursor ${formatNs(cursorNs)}` : ""}
            </span>
          </div>
          <canvas
            ref={canvas}
            aria-label={`Waveform of ${selected.filename}`}
            className="w-full cursor-crosshair border border-border"
            onClick={(event) => setCursorNs(timeAt(event.clientX))}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={protocol}
              onValueChange={(value) => {
                if (value !== null) {
                  setProtocol(value);
                  setDecoded(null);
                }
              }}
            >
              <SelectTrigger size="xs" className="w-24" aria-label="Decoder">
                <SelectValue>{protocol.toUpperCase()}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {(["uart", "spi", "i2c"] as const).map((item) => (
                  <SelectItem key={item} value={item}>
                    {item.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            {LINES[protocol].map((name) => (
              <Select
                key={name}
                value={lines[name] ?? null}
                onValueChange={(value) => setLines({ ...lines, [name]: value ?? "" })}
              >
                <SelectTrigger size="xs" className="w-28" aria-label={`${name} channel`}>
                  <SelectValue>{lines[name] ? `${name}: ${lines[name]}` : name}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  {selected.channels.map((channel) => (
                    <SelectItem key={channel} value={channel}>
                      {channel}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ))}
            {protocol === "uart" && (
              <Input
                aria-label="Baud rate"
                className="w-24"
                value={baud}
                onChange={(event) => setBaud(event.target.value)}
              />
            )}
            <Button
              size="xs"
              variant="outline"
              disabled={busy || !decoderFor()}
              onClick={() =>
                void run(async () => {
                  const decoder = decoderFor();
                  if (!decoder) return;
                  const response = await decodeCapture({
                    environmentId: threadRef.environmentId,
                    input: {
                      projectId,
                      captureId: selected.id,
                      decoder,
                      startNs: shown.startNs,
                      endNs: shown.endNs,
                      limit: 2000,
                    },
                  });
                  if (response._tag === "Failure") throw squashAtomCommandFailure(response);
                  if (alive.current) setDecoded(response.value);
                })
              }
            >
              Decode window
            </Button>
            {canCite && (
              <Button
                size="xs"
                variant="outline"
                onClick={() =>
                  onCite({
                    captureId: selected.id,
                    label: selected.filename,
                    signal: lines[LINES[protocol][0]!] || selected.channels[0] || "",
                    startNs: shown.startNs,
                    endNs: shown.endNs,
                  })
                }
              >
                Cite window in a finding
              </Button>
            )}
          </div>
          {decoded && (
            <div className="max-h-48 overflow-auto border border-border font-mono">
              {decoded.events.length === 0 && (
                <p className="p-2 text-muted-foreground">Nothing decoded in this window.</p>
              )}
              {decoded.events.map((event) => (
                <button
                  type="button"
                  key={`${event.startNs}:${event.text}`}
                  className="flex w-full gap-3 border-b border-border px-2 py-1 text-left hover:bg-accent"
                  onClick={() => {
                    const pad = Math.max(200, (event.endNs - event.startNs) * 2);
                    setRange({
                      startNs: Math.max(0, event.startNs - pad),
                      endNs: event.endNs + pad,
                    });
                    setCursorNs(event.startNs);
                  }}
                >
                  <span className="w-24 shrink-0 text-muted-foreground">
                    {formatNs(event.startNs)}
                  </span>
                  <span>{event.text}</span>
                </button>
              ))}
              {decoded.truncated && (
                <p className="p-2 text-muted-foreground">
                  More events follow; zoom in to see them.
                </p>
              )}
            </div>
          )}
          {confirmDelete ? (
            <div className="flex gap-2">
              <Button
                size="xs"
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const response = await removeCapture({
                      environmentId: threadRef.environmentId,
                      input: { projectId, captureId: selected.id },
                    });
                    if (response._tag === "Failure") throw squashAtomCommandFailure(response);
                    if (!alive.current) return;
                    setSelectedId(null);
                    setConfirmDelete(false);
                    onChanged();
                  })
                }
              >
                Delete
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </div>
          ) : (
            <Button size="xs" variant="ghost-destructive" onClick={() => setConfirmDelete(true)}>
              Delete capture
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
