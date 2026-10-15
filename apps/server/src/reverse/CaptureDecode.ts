import type { ParsedCapture } from "./CaptureFormats.ts";

type Channel = ParsedCapture["channels"][number];

/** Index of the first edge strictly after `timeNs`. */
function firstAfter(edges: Float64Array, timeNs: number): number {
  let lo = 0,
    hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (edges[mid]! <= timeNs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first edge at or after `timeNs`. */
function firstAtOrAfter(edges: Float64Array, timeNs: number): number {
  let lo = 0,
    hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (edges[mid]! < timeNs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The part of a capture to decode; events starting after `toNs` are not reported. */
export interface DecodeRange {
  fromNs: number;
  toNs: number;
  limit: number;
}

/** Level of a channel at a time; edges alternate it from the initial level. */
export function levelAt(channel: Channel, timeNs: number): 0 | 1 {
  return ((channel.initial + firstAfter(channel.edges, timeNs)) % 2) as 0 | 1;
}

/** The first edge strictly after `timeNs` that lands on `value` (any edge if omitted). */
function nextEdge(channel: Channel, timeNs: number, value?: 0 | 1): number | null {
  for (let index = firstAfter(channel.edges, timeNs); index < channel.edges.length; index++)
    if (value === undefined || (channel.initial + index + 1) % 2 === value)
      return channel.edges[index]!;
  return null;
}

export interface CaptureWindow {
  startNs: number;
  endNs: number;
  channels: Array<{
    name: string;
    level: 0 | 1;
    /** Edges in the window, when there are few enough to draw one by one. */
    edges: number[] | null;
    /** Otherwise: spans of the window where the signal toggles, merged per pixel bucket. */
    busy: Array<[number, number]> | null;
  }>;
}

/** What to draw for a time window, bounded no matter how dense the capture is. */
export function captureWindow(
  capture: ParsedCapture,
  startNs: number,
  endNs: number,
  maxPoints: number,
): CaptureWindow {
  const span = Math.max(1, endNs - startNs);
  return {
    startNs,
    endNs,
    channels: capture.channels.map((channel) => {
      const from = firstAfter(channel.edges, startNs);
      const to = firstAfter(channel.edges, endNs);
      const level = levelAt(channel, startNs);
      if (to - from <= maxPoints)
        return {
          name: channel.name,
          level,
          edges: Array.from(channel.edges.subarray(from, to)),
          busy: null,
        };
      const bucketNs = span / maxPoints;
      const busy: Array<[number, number]> = [];
      for (let index = from; index < to;) {
        const bucket = Math.floor((channel.edges[index]! - startNs) / bucketNs);
        const bucketEnd = startNs + (bucket + 1) * bucketNs;
        const last = busy.at(-1);
        const begin = startNs + bucket * bucketNs;
        if (last && last[1] >= begin) last[1] = bucketEnd;
        else busy.push([begin, bucketEnd]);
        index = Math.max(index + 1, firstAfter(channel.edges, bucketEnd));
      }
      return { name: channel.name, level, edges: null, busy };
    }),
  };
}

export interface DecodedEvent {
  startNs: number;
  endNs: number;
  /** A short human reading, like `0x41 'A'` or `addr 0x50 write ack`. */
  text: string;
  fields: Record<string, string | number | boolean>;
}

const channelNamed = (capture: ParsedCapture, name: string): Channel => {
  const channel = capture.channels.find((item) => item.name === name);
  if (!channel) throw new Error(`The capture has no channel named ${name}.`);
  return channel;
};
const hex = (value: number, width = 2) => `0x${value.toString(16).padStart(width, "0")}`;
const printable = (byte: number) =>
  byte >= 32 && byte < 127 ? ` '${String.fromCharCode(byte)}'` : "";

export interface UartConfig {
  baud: number;
  dataBits?: 7 | 8 | 9 | undefined;
  parity?: "none" | "even" | "odd" | undefined;
  stopBits?: 1 | 2 | undefined;
  inverted?: boolean | undefined;
}

/** UART frames sampled at bit centers, the same model as Veritas's decoder. */
export function decodeUart(
  capture: ParsedCapture,
  signal: string,
  config: UartConfig,
  range: DecodeRange,
): DecodedEvent[] {
  if (!Number.isInteger(config.baud) || config.baud <= 0)
    throw new Error("Baud must be a positive integer.");
  const channel = channelNamed(capture, signal);
  const dataBits = config.dataBits ?? 8,
    parity = config.parity ?? "none",
    stopBits = config.stopBits ?? 1,
    inverted = config.inverted ?? false;
  const bitNs = 1e9 / config.baud;
  const idle: 0 | 1 = inverted ? 0 : 1;
  const active: 0 | 1 = inverted ? 1 : 0;
  const logical = (level: 0 | 1) => (inverted ? ((level ^ 1) as 0 | 1) : level);
  const parityBits = parity === "none" ? 0 : 1;
  const frameBits = 1 + dataBits + parityBits + stopBits;
  const events: DecodedEvent[] = [];
  let cursor = range.fromNs - 1;
  while (events.length < range.limit) {
    const t0 = nextEdge(channel, cursor, active);
    if (t0 === null || t0 > range.toNs) break;
    // A glitch shorter than half a bit is not a start bit.
    if (levelAt(channel, t0 + 0.5 * bitNs) !== active) {
      cursor = t0;
      continue;
    }
    let byte = 0,
      ones = 0;
    for (let bit = 0; bit < dataBits; bit++) {
      const value = logical(levelAt(channel, t0 + (1 + bit + 0.5) * bitNs));
      byte |= value << bit;
      ones += value;
    }
    let parityOk: boolean | null = null;
    if (parity !== "none") {
      const value = logical(levelAt(channel, t0 + (1 + dataBits + 0.5) * bitNs));
      parityOk = ((ones + value) % 2 === 0) === (parity === "even");
    }
    let framingOk = true;
    for (let stop = 0; stop < stopBits; stop++)
      if (levelAt(channel, t0 + (1 + dataBits + parityBits + stop + 0.5) * bitNs) !== idle)
        framingOk = false;
    const endNs = Math.round(t0 + frameBits * bitNs);
    events.push({
      startNs: t0,
      endNs,
      text: `${hex(byte)}${printable(byte)}${framingOk ? "" : " framing error"}${parityOk === false ? " parity error" : ""}`,
      fields: { byte, framingOk, ...(parityOk === null ? {} : { parityOk }) },
    });
    cursor = endNs - 1;
  }
  return events;
}

export interface SpiConfig {
  clk: string;
  mosi?: string | undefined;
  miso?: string | undefined;
  /** Active-low chip select. */
  cs?: string | undefined;
  cpol?: 0 | 1 | undefined;
  cpha?: 0 | 1 | undefined;
  wordSize?: number | undefined;
  bitOrder?: "msb" | "lsb" | undefined;
}

/** SPI words sampled on the mode's clock edge, realigned whenever chip select toggles. */
export function decodeSpi(
  capture: ParsedCapture,
  config: SpiConfig,
  range: DecodeRange,
): DecodedEvent[] {
  if (!config.mosi && !config.miso) throw new Error("SPI decoding needs MOSI or MISO.");
  const wordSize = config.wordSize ?? 8;
  if (!Number.isInteger(wordSize) || wordSize < 1 || wordSize > 32)
    throw new Error("Word size must be 1 to 32 bits.");
  const clk = channelNamed(capture, config.clk);
  const mosi = config.mosi ? channelNamed(capture, config.mosi) : null;
  const miso = config.miso ? channelNamed(capture, config.miso) : null;
  const cs = config.cs ? channelNamed(capture, config.cs) : null;
  const sampleValue: 0 | 1 = (config.cpol ?? 0) === (config.cpha ?? 0) ? 1 : 0;
  const msb = (config.bitOrder ?? "msb") === "msb";
  const events: DecodedEvent[] = [];
  let bits = 0,
    mosiWord = 0,
    misoWord = 0,
    wordStart = 0;
  let csActive = cs ? levelAt(cs, range.fromNs) === 0 : true;
  const push = (word: number, bit: 0 | 1) =>
    msb ? ((word << 1) | bit) >>> 0 : (word | (bit << bits)) >>> 0;
  for (
    let index = firstAtOrAfter(clk.edges, range.fromNs);
    index < clk.edges.length && events.length < range.limit;
    index++
  ) {
    const timeNs = clk.edges[index]!;
    if (timeNs > range.toNs) break;
    if (cs) {
      const active = levelAt(cs, timeNs) === 0;
      if (active !== csActive) {
        // A word torn by chip select is dropped, not reported.
        bits = mosiWord = misoWord = 0;
        csActive = active;
      }
      if (!active) continue;
    }
    if ((clk.initial + index + 1) % 2 !== sampleValue) continue;
    if (bits === 0) wordStart = timeNs;
    if (mosi) mosiWord = push(mosiWord, levelAt(mosi, timeNs));
    if (miso) misoWord = push(misoWord, levelAt(miso, timeNs));
    if (++bits === wordSize) {
      const width = Math.ceil(wordSize / 4);
      events.push({
        startNs: wordStart,
        endNs: timeNs,
        text: [
          mosi ? `MOSI ${hex(mosiWord, width)}` : "",
          miso ? `MISO ${hex(misoWord, width)}` : "",
        ]
          .filter(Boolean)
          .join(" "),
        fields: { ...(mosi ? { mosi: mosiWord } : {}), ...(miso ? { miso: misoWord } : {}) },
      });
      bits = mosiWord = misoWord = 0;
    }
  }
  return events;
}

/** I²C starts, stops, addresses and data bytes from SDA and SCL. */
export function decodeI2c(
  capture: ParsedCapture,
  wiring: { sda: string; scl: string },
  range: DecodeRange,
): DecodedEvent[] {
  const sda = channelNamed(capture, wiring.sda);
  const scl = channelNamed(capture, wiring.scl);
  const events: DecodedEvent[] = [];
  let inTransaction = false,
    expectAddress = false,
    bits: Array<0 | 1> = [],
    byteStart = 0;
  // Walk both channels' edges in time order; on a tie, the clock edge counts first.
  let s = firstAtOrAfter(sda.edges, range.fromNs),
    c = firstAtOrAfter(scl.edges, range.fromNs);
  while ((s < sda.edges.length || c < scl.edges.length) && events.length < range.limit) {
    const sdaNext = s < sda.edges.length ? sda.edges[s]! : Infinity;
    const sclNext = c < scl.edges.length ? scl.edges[c]! : Infinity;
    if (Math.min(sdaNext, sclNext) > range.toNs) break;
    if (sclNext <= sdaNext) {
      const rising = (scl.initial + c + 1) % 2 === 1;
      c++;
      if (!rising || !inTransaction) continue;
      if (bits.length === 0) byteStart = sclNext;
      bits.push(levelAt(sda, sclNext));
      if (bits.length === 9) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) byte = (byte << 1) | bits[bit]!;
        const ack = bits[8] === 0;
        events.push(
          expectAddress
            ? {
                startNs: byteStart,
                endNs: sclNext,
                text: `addr ${hex(byte >> 1)} ${byte & 1 ? "read" : "write"} ${ack ? "ack" : "nack"}`,
                fields: { type: "address", address: byte >> 1, read: (byte & 1) === 1, ack },
              }
            : {
                startNs: byteStart,
                endNs: sclNext,
                text: `${hex(byte)}${printable(byte)} ${ack ? "ack" : "nack"}`,
                fields: { type: "data", byte, ack },
              },
        );
        expectAddress = false;
        bits = [];
      }
      continue;
    }
    const rising = (sda.initial + s + 1) % 2 === 1;
    s++;
    if (levelAt(scl, sdaNext) !== 1) continue;
    if (!rising) {
      events.push({
        startNs: sdaNext,
        endNs: sdaNext,
        text: inTransaction ? "restart" : "start",
        fields: { type: inTransaction ? "restart" : "start" },
      });
      inTransaction = true;
      expectAddress = true;
      bits = [];
    } else if (inTransaction) {
      events.push({ startNs: sdaNext, endNs: sdaNext, text: "stop", fields: { type: "stop" } });
      inTransaction = false;
      bits = [];
    }
  }
  return events;
}
