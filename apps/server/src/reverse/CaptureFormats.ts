import { strFromU8, unzipSync } from "fflate";

/**
 * Logic-analyzer captures reduced to one shape: per channel, its level at time zero and the
 * times of every later edge. Edges alternate the level, so values are implied. Times are
 * nanoseconds from the start of the capture.
 */
export interface ParsedCapture {
  format: "vcd" | "sigrok" | "saleae-binary" | "saleae-csv";
  durationNs: number;
  sampleRateHz: number | null;
  channels: Array<{ name: string; initial: 0 | 1; edges: Float64Array }>;
  /** Set when the capture had more edges than T3 keeps; later edges are dropped. */
  truncated: boolean;
  /** Signals the parser skipped, such as multi-bit VCD vectors. */
  skipped: string[];
}

export class CaptureFormatError extends Error {}

const DUMP_SECTIONS = new Set(["$dumpvars", "$dumpall", "$dumpon", "$dumpoff"]);
// Channel names fit the 256-character ids used to cite them.
const MAX_NAME = 200;
const MAX_SKIPPED = 50;
const noteSkipped = (skipped: string[], name: string) => {
  if (skipped.length < MAX_SKIPPED) skipped.push(name.slice(-MAX_NAME));
  else if (skipped.length === MAX_SKIPPED) skipped.push("and more");
};

// Parsing runs on the server's event loop; long parses hand it back regularly.
const YIELD_EVERY = 1 << 20;
const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

const MAX_EDGES = 8_000_000;
const MAX_UNZIPPED_BYTES = 512 * 1024 * 1024;

/** Collects edges per channel under one shared budget. */
class EdgeSink {
  readonly edges: number[][] = [];
  total = 0;
  truncated = false;
  constructor(channels: number) {
    for (let i = 0; i < channels; i++) this.edges.push([]);
  }
  push(channel: number, timeNs: number): boolean {
    if (this.total >= MAX_EDGES) {
      this.truncated = true;
      return false;
    }
    this.edges[channel]!.push(timeNs);
    this.total++;
    return true;
  }
}

function finish(
  format: ParsedCapture["format"],
  names: string[],
  initial: Array<0 | 1>,
  sink: EdgeSink,
  durationNs: number,
  sampleRateHz: number | null,
  skipped: string[] = [],
): ParsedCapture {
  // These are stored in the project record; a NaN there would make it unreadable.
  if (!Number.isFinite(durationNs) || durationNs < 0)
    throw new CaptureFormatError("The capture has no valid duration.");
  if (sampleRateHz !== null && !(Number.isFinite(sampleRateHz) && sampleRateHz > 0))
    throw new CaptureFormatError("The capture has no valid sample rate.");
  return {
    format,
    durationNs,
    sampleRateHz,
    channels: names.map((name, index) => ({
      name,
      initial: initial[index] ?? 0,
      edges: Float64Array.from(sink.edges[index]!),
    })),
    truncated: sink.truncated,
    skipped,
  };
}

const TIMESCALE_NS: Record<string, number> = {
  s: 1e9,
  ms: 1e6,
  us: 1e3,
  ns: 1,
  ps: 1e-3,
  fs: 1e-6,
};

/**
 * Value Change Dump with scalar wires, as written by PulseView, Glasgow, simulators and most
 * logic analyzers. Vectors and reals are listed in `skipped`; x and z read as low.
 */
export async function parseVcd(text: string): Promise<ParsedCapture> {
  let work = 0;
  let pos = 0;
  const next = (): string | null => {
    while (pos < text.length && text.charCodeAt(pos) <= 32) pos++;
    if (pos >= text.length) return null;
    const start = pos;
    while (pos < text.length && text.charCodeAt(pos) > 32) pos++;
    return text.slice(start, pos);
  };
  const skipToEnd = () => {
    for (let token = next(); token !== null && token !== "$end"; token = next());
  };

  let timescaleNs = 1;
  const names: string[] = [];
  const ids = new Map<string, number>();
  const skipped: string[] = [];
  const scopes: string[] = [];
  for (let token = next(); token !== null; token = next()) {
    if (token === "$enddefinitions") {
      skipToEnd();
      break;
    }
    if (token === "$timescale") {
      const parts: string[] = [];
      for (let part = next(); part !== null && part !== "$end"; part = next()) parts.push(part);
      const match = /^(\d+)(s|ms|us|ns|ps|fs)$/.exec(parts.join(""));
      if (!match) throw new CaptureFormatError(`Unsupported VCD timescale ${parts.join(" ")}.`);
      timescaleNs = Number(match[1]) * TIMESCALE_NS[match[2]!]!;
    } else if (token === "$scope") {
      next();
      scopes.push(next() ?? "");
      skipToEnd();
    } else if (token === "$upscope") {
      scopes.pop();
      skipToEnd();
    } else if (token === "$var") {
      const kind = next(),
        width = next(),
        id = next(),
        base = next();
      // A bit select such as `data [3]` keeps its index in the name.
      const select = [];
      for (let part = next(); part !== null && part !== "$end"; part = next()) select.push(part);
      if (!id || !base) throw new CaptureFormatError("Malformed VCD $var declaration.");
      const name = select.length ? `${base}${select.join("")}` : base;
      if (width !== "1" || kind === "real") {
        noteSkipped(skipped, name);
        continue;
      }
      // Aliased ids (one signal declared twice) share a channel.
      if (ids.has(id)) continue;
      const scoped = (scopes.length > 1 ? `${scopes.slice(1).join(".")}.${name}` : name).slice(
        -MAX_NAME,
      );
      ids.set(id, names.length);
      names.push(
        names.includes(scoped) ? `${scoped.slice(-MAX_NAME + 8)}#${names.length}` : scoped,
      );
    } else if (token.startsWith("$")) skipToEnd();
  }
  if (names.length === 0) throw new CaptureFormatError("The VCD file declares no 1-bit signals.");

  const sink = new EdgeSink(names.length);
  const level: Array<0 | 1 | null> = names.map(() => null);
  const initial: Array<0 | 1> = names.map(() => 0);
  let timeNs = 0;
  let lastNs = 0;
  for (let token = next(); token !== null && !sink.truncated; token = next()) {
    if (++work % YIELD_EVERY === 0) await yieldToEventLoop();
    const first = token.charCodeAt(0);
    if (first === 35 /* # */) {
      timeNs = Number(token.slice(1)) * timescaleNs;
      if (!Number.isFinite(timeNs) || timeNs < 0)
        throw new CaptureFormatError(`Invalid VCD timestamp ${token.slice(0, 40)}.`);
      lastNs = Math.max(lastNs, timeNs);
      continue;
    }
    if (token.startsWith("$")) {
      // Dump sections hold value changes; any other keyword's body ($comment…) is skipped whole.
      if (!DUMP_SECTIONS.has(token) && token !== "$end") skipToEnd();
      continue;
    }
    let value: 0 | 1;
    let id: string;
    if (first === 98 || first === 66 || first === 114 || first === 82) {
      // b/r value then its identifier: a 1-bit wire written in vector form takes its last bit.
      id = next() ?? "";
      if (first === 114 || first === 82 || !ids.has(id)) continue;
      value = token.charCodeAt(token.length - 1) === 49 ? 1 : 0;
    } else {
      value = first === 49 /* 1 */ ? 1 : 0;
      id = token.slice(1);
    }
    const channel = ids.get(id);
    if (channel === undefined) continue;
    const previous = level[channel];
    if (previous === null) {
      initial[channel] = value;
      level[channel] = value;
      if (timeNs > 0 && value !== 0) {
        // First reported after time zero: treat it as low until then.
        initial[channel] = 0;
        sink.push(channel, timeNs);
      }
    } else if (previous !== value) {
      level[channel] = value;
      sink.push(channel, timeNs);
    }
  }
  return finish("vcd", names, initial, sink, lastNs, null, skipped);
}

function unzipBounded(
  bytes: Uint8Array,
  keep: (name: string) => boolean,
): Record<string, Uint8Array> {
  let total = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      if (!keep(file.name)) return false;
      total += file.originalSize;
      if (total > MAX_UNZIPPED_BYTES)
        throw new CaptureFormatError("The capture expands to more than 512 MiB.");
      return true;
    },
  });
}

const RATE_UNITS: Record<string, number> = { hz: 1, khz: 1e3, mhz: 1e6, ghz: 1e9 };

/** sigrok session files (v2 srzip): `metadata` INI plus little-endian `logic-1-N` chunks. */
export async function parseSigrok(bytes: Uint8Array): Promise<ParsedCapture> {
  const files = unzipBounded(
    bytes,
    (name) => name === "version" || name === "metadata" || /^logic-1(-\d+)?$/.test(name),
  );
  if (!files.version || !files.metadata)
    throw new CaptureFormatError("Not a sigrok session file: version or metadata is missing.");
  if (strFromU8(files.version).trim() !== "2")
    throw new CaptureFormatError("Only sigrok session format version 2 is supported.");
  const device: Record<string, string> = {};
  let section = "";
  for (const raw of strFromU8(files.metadata).split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) section = header[1]!;
    else if (section === "device 1" && line.includes("=")) {
      const at = line.indexOf("=");
      device[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  const rate = /^([\d.]+)\s*([kmg]?hz)?$/i.exec(device.samplerate ?? "");
  const sampleRateHz = rate ? Number(rate[1]) * RATE_UNITS[(rate[2] ?? "hz").toLowerCase()]! : 0;
  const unitsize = Number(device.unitsize ?? "1");
  if (!(sampleRateHz > 0)) throw new CaptureFormatError("The sigrok capture has no sample rate.");
  if (![1, 2, 4, 8].includes(unitsize))
    throw new CaptureFormatError(`Unsupported sigrok unit size ${device.unitsize}.`);

  const bits: number[] = [];
  const names: string[] = [];
  for (const [key, value] of Object.entries(device)) {
    const probe = /^probe(\d+)$/.exec(key);
    if (probe) {
      bits.push(Number(probe[1]) - 1);
      names.push(value.slice(0, MAX_NAME));
    }
  }
  if (names.length === 0) throw new CaptureFormatError("The sigrok capture has no logic channels.");
  const order = bits
    .map((bit, index) => ({ bit, name: names[index]! }))
    .sort((a, b) => a.bit - b.bit);

  const chunks = Object.keys(files)
    .filter((name) => name.startsWith("logic-1"))
    .sort((a, b) => Number(a.split("-")[2] ?? 1) - Number(b.split("-")[2] ?? 1));
  const sink = new EdgeSink(order.length);
  const initial: Array<0 | 1> = order.map(() => 0);
  const level: Array<0 | 1> = order.map(() => 0);
  const nsPerSample = 1e9 / sampleRateHz;
  let sample = 0;
  let previousLow = -1,
    previousHigh = -1;
  for (const chunk of chunks) {
    const data = files[chunk]!;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (
      let offset = 0;
      offset + unitsize <= data.byteLength && !sink.truncated;
      offset += unitsize, sample++
    ) {
      // Channels beyond 32 need the high word of an 8-byte unit.
      const low =
        unitsize === 1
          ? view.getUint8(offset)
          : unitsize === 2
            ? view.getUint16(offset, true)
            : view.getUint32(offset, true);
      const high = unitsize === 8 ? view.getUint32(offset + 4, true) : 0;
      if (sample % YIELD_EVERY === 0) await yieldToEventLoop();
      // Most samples repeat the last one; only a changed word can hold an edge.
      if (low === previousLow && high === previousHigh) continue;
      previousLow = low;
      previousHigh = high;
      for (let channel = 0; channel < order.length; channel++) {
        const bit = order[channel]!.bit;
        const value = ((bit < 32 ? low >>> bit : high >>> (bit - 32)) & 1) as 0 | 1;
        if (sample === 0) {
          initial[channel] = value;
          level[channel] = value;
        } else if (value !== level[channel]) {
          level[channel] = value;
          sink.push(channel, Math.round(sample * nsPerSample));
        }
      }
    }
  }
  return finish(
    "sigrok",
    order.map((entry) => entry.name),
    initial,
    sink,
    Math.round(sample * nsPerSample),
    sampleRateHz,
  );
}

/**
 * One channel of Saleae Logic 2's documented binary export: `<SALEAE>`, version, type 0
 * (digital), then version 0's single run or version 1's chunks.
 */
function readSaleaeDigital(data: Uint8Array): {
  initial: 0 | 1;
  beginS: number;
  endS: number;
  times: number[];
  rate: number | null;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < 16 || strFromU8(data.subarray(0, 8)) !== "<SALEAE>")
    throw new CaptureFormatError("Not a Saleae binary export: the <SALEAE> header is missing.");
  const version = view.getInt32(8, true);
  if (view.getInt32(12, true) !== 0)
    throw new CaptureFormatError("Only digital Saleae exports are supported, not analog.");
  let offset = 16;
  const need = (bytes: number) => {
    if (offset + bytes > data.byteLength)
      throw new CaptureFormatError("The Saleae export is truncated.");
  };
  const readRun = (withRate: boolean) => {
    need(withRate ? 36 : 28);
    const initial = (view.getUint32(offset, true) ? 1 : 0) as 0 | 1;
    offset += 4;
    const rate = withRate ? view.getFloat64(offset, true) : null;
    if (withRate) offset += 8;
    const beginS = view.getFloat64(offset, true);
    const endS = view.getFloat64(offset + 8, true);
    const count = Number(view.getBigUint64(offset + 16, true));
    offset += 24;
    need(count * 8);
    const times: number[] = [];
    for (let i = 0; i < count; i++, offset += 8) times.push(view.getFloat64(offset, true));
    return { initial, rate, beginS, endS, times };
  };
  if (version === 0) return readRun(false);
  if (version !== 1) throw new CaptureFormatError(`Unsupported Saleae export version ${version}.`);
  need(8);
  const chunkCount = Number(view.getBigUint64(offset, true));
  offset += 8;
  // Every chunk needs at least its 36-byte header.
  if (chunkCount > (data.byteLength - offset) / 36)
    throw new CaptureFormatError("The Saleae export is truncated.");
  const runs = Array.from({ length: chunkCount }, () => readRun(true));
  if (runs.length === 0) throw new CaptureFormatError("The Saleae export has no data.");
  // Gaps between chunks keep the last level unless the next chunk starts at another one.
  const times: number[] = [];
  let level = runs[0]!.initial;
  for (const [index, run] of runs.entries()) {
    if (index > 0 && run.initial !== level) times.push(run.beginS);
    for (const time of run.times) times.push(time);
    level = ((run.initial + run.times.length) % 2) as 0 | 1;
  }
  return {
    initial: runs[0]!.initial,
    beginS: runs[0]!.beginS,
    endS: runs.at(-1)!.endS,
    times,
    rate: runs[0]!.rate,
  };
}

function fromSaleaeRuns(
  runs: Array<{ name: string; run: ReturnType<typeof readSaleaeDigital> }>,
): ParsedCapture {
  const startS = Math.min(...runs.map(({ run }) => run.beginS));
  const sink = new EdgeSink(runs.length);
  for (const [channel, { run }] of runs.entries())
    for (const time of run.times) if (!sink.push(channel, Math.round((time - startS) * 1e9))) break;
  const endS = Math.max(...runs.map(({ run }) => run.endS));
  return finish(
    "saleae-binary",
    runs.map(({ name }) => name),
    runs.map(({ run }) => run.initial),
    sink,
    Math.round((endS - startS) * 1e9),
    runs[0]!.run.rate,
  );
}

const saleaeChannelName = (file: string) => {
  const match = /digital_(\d+)\.bin$/i.exec(file);
  return match ? `D${match[1]}` : file.replace(/^.*\//, "").replace(/\.bin$/i, "");
};

/** A single `digital_N.bin`, or a zip of them as Logic 2 writes into an export folder. */
export function parseSaleaeBinary(bytes: Uint8Array, filename: string): ParsedCapture {
  if (strFromU8(bytes.subarray(0, 8)) === "<SALEAE>")
    return fromSaleaeRuns([{ name: saleaeChannelName(filename), run: readSaleaeDigital(bytes) }]);
  const files = unzipBounded(bytes, (name) => /(^|\/)digital_\d+\.bin$/i.test(name));
  const names = Object.keys(files).sort(
    (a, b) => Number(/(\d+)\.bin$/i.exec(a)![1]) - Number(/(\d+)\.bin$/i.exec(b)![1]),
  );
  if (names.length === 0)
    throw new CaptureFormatError("The zip holds no Saleae digital_N.bin exports.");
  return fromSaleaeRuns(
    names.map((name) => ({ name: saleaeChannelName(name), run: readSaleaeDigital(files[name]!) })),
  );
}

/** Logic 2's CSV export: `Time [s],<channel>,...`, one row per change. */
export async function parseSaleaeCsv(text: string): Promise<ParsedCapture> {
  // Walk lines in place: a large export split into an array costs several times its size.
  let pos = 0;
  const nextLine = (): string | null => {
    while (pos < text.length) {
      let end = text.indexOf("\n", pos);
      if (end < 0) end = text.length;
      const line = text.slice(pos, end).replace(/\r$/, "");
      pos = end + 1;
      if (line.trim() !== "") return line;
    }
    return null;
  };
  const header =
    nextLine()
      ?.split(",")
      .map((cell) => cell.trim()) ?? [];
  if (!/^time/i.test(header[0] ?? "") || header.length < 2)
    throw new CaptureFormatError("Not a Saleae digital CSV export: expected a Time column first.");
  const names = header.slice(1).map((name) => name.slice(0, MAX_NAME));
  const sink = new EdgeSink(names.length);
  const initial: Array<0 | 1> = names.map(() => 0);
  const level: Array<0 | 1> = names.map(() => 0);
  let startS = 0;
  let lastNs = 0;
  for (let row = 0, line = nextLine(); line !== null && !sink.truncated; row++, line = nextLine()) {
    if (row % YIELD_EVERY === 0) await yieldToEventLoop();
    const cells = line.split(",");
    const timeS = Number(cells[0]);
    if (!Number.isFinite(timeS)) throw new CaptureFormatError(`Row ${row + 2} has no time.`);
    if (row === 0) startS = timeS;
    const timeNs = Math.round((timeS - startS) * 1e9);
    lastNs = timeNs;
    for (let channel = 0; channel < names.length; channel++) {
      const value = (cells[channel + 1]?.trim() === "1" ? 1 : 0) as 0 | 1;
      if (row === 0) {
        initial[channel] = value;
        level[channel] = value;
      } else if (value !== level[channel]) {
        level[channel] = value;
        sink.push(channel, timeNs);
      }
    }
  }
  return finish("saleae-csv", names, initial, sink, lastNs, null);
}

/** Picks a parser from the file name and contents. */
export async function parseCapture(bytes: Uint8Array, filename: string): Promise<ParsedCapture> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".sal"))
    throw new CaptureFormatError(
      "Saleae does not document its .sal format and changes it between versions. In Logic 2, use File → Export Raw Data and choose Binary (or CSV) for the digital channels, then import the exported digital_N.bin, a zip of them, or the CSV.",
    );
  if (lower.endsWith(".vcd")) return parseVcd(strFromU8(bytes));
  if (lower.endsWith(".sr")) return parseSigrok(bytes);
  if (lower.endsWith(".csv")) return parseSaleaeCsv(strFromU8(bytes));
  if (lower.endsWith(".bin") || lower.endsWith(".zip")) return parseSaleaeBinary(bytes, filename);
  throw new CaptureFormatError(
    "Unsupported capture format. Import a VCD (.vcd), a sigrok session (.sr), or a Saleae Logic 2 export (digital_N.bin, a zip of them, or CSV).",
  );
}
