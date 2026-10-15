import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { captureWindow, decodeI2c, decodeSpi, decodeUart, levelAt } from "./CaptureDecode.ts";
import { parseCapture, type ParsedCapture } from "./CaptureFormats.ts";

const all = { fromNs: 0, toNs: Infinity, limit: 100 };
const edgesOf = (capture: ParsedCapture, name: string) =>
  Array.from(capture.channels.find((channel) => channel.name === name)!.edges);

/** A capture built from levels per fixed time step, for decoder tests. */
function fromLevels(stepNs: number, channels: Record<string, Array<0 | 1>>): ParsedCapture {
  return {
    format: "vcd",
    durationNs: 0,
    sampleRateHz: null,
    truncated: false,
    skipped: [],
    channels: Object.entries(channels).map(([name, levels]) => ({
      name,
      initial: levels[0]!,
      edges: Float64Array.from(
        levels.flatMap((level, index) =>
          index > 0 && level !== levels[index - 1] ? [index * stepNs] : [],
        ),
      ),
    })),
  };
}

/** UART levels for bytes at one sample per bit, idle high, 8N1. */
function uartLevels(bytes: number[]): Array<0 | 1> {
  const levels: Array<0 | 1> = [1, 1];
  for (const byte of bytes) {
    levels.push(0);
    for (let bit = 0; bit < 8; bit++) levels.push(((byte >> bit) & 1) as 0 | 1);
    levels.push(1, 1);
  }
  return levels;
}

describe("capture formats", () => {
  it("reads VCD scalar wires, skipping vectors", () => {
    const capture = parseCapture(
      strToU8(`$timescale 1 us $end
$scope module top $end
$var wire 1 ! tx $end
$var wire 1 " clk $end
$var wire 8 # bus $end
$upscope $end
$enddefinitions $end
#0
$dumpvars
1!
0"
b00000000 #
$end
#5
0!
1"
#9
1!
#12
`),
      "logic.vcd",
    );
    expect(capture.channels.map((channel) => channel.name)).toEqual(["tx", "clk"]);
    expect(capture.skipped).toEqual(["bus"]);
    expect(capture.channels[0]!.initial).toBe(1);
    expect(edgesOf(capture, "tx")).toEqual([5000, 9000]);
    expect(edgesOf(capture, "clk")).toEqual([5000]);
    expect(capture.durationNs).toBe(12000);
  });

  it("reads sigrok v2 session files across chunks", () => {
    const capture = parseCapture(
      zipSync({
        version: strToU8("2"),
        metadata: strToU8(
          "[global]\nsigrok version=0.5.2\n\n[device 1]\ncapturefile=logic-1\ntotal probes=2\nsamplerate=1 MHz\nprobe1=SCL\nprobe2=SDA\nunitsize=1\n",
        ),
        "logic-1-1": new Uint8Array([0b11, 0b11, 0b01]),
        "logic-1-2": new Uint8Array([0b00, 0b10]),
      }),
      "bus.sr",
    );
    expect(capture).toMatchObject({ format: "sigrok", sampleRateHz: 1_000_000, durationNs: 5000 });
    expect(capture.channels.map((channel) => [channel.name, channel.initial])).toEqual([
      ["SCL", 1],
      ["SDA", 1],
    ]);
    expect(edgesOf(capture, "SCL")).toEqual([3000]);
    expect(edgesOf(capture, "SDA")).toEqual([2000, 4000]);
  });

  it("reads Saleae binary exports, version 0 and chunked version 1", () => {
    const header = (version: number) => {
      const bytes = new Uint8Array(16);
      bytes.set(strToU8("<SALEAE>"));
      new DataView(bytes.buffer).setInt32(8, version, true);
      return bytes;
    };
    const join = (...parts: Uint8Array[]) => {
      const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
      let offset = 0;
      for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
      }
      return out;
    };
    const run = (
      initial: number,
      rate: number | null,
      begin: number,
      end: number,
      times: number[],
    ) => {
      const bytes = new Uint8Array(4 + (rate === null ? 0 : 8) + 24 + times.length * 8);
      const view = new DataView(bytes.buffer);
      let offset = 0;
      view.setUint32(offset, initial, true);
      offset += 4;
      if (rate !== null) {
        view.setFloat64(offset, rate, true);
        offset += 8;
      }
      view.setFloat64(offset, begin, true);
      view.setFloat64(offset + 8, end, true);
      view.setBigUint64(offset + 16, BigInt(times.length), true);
      offset += 24;
      for (const time of times) {
        view.setFloat64(offset, time, true);
        offset += 8;
      }
      return bytes;
    };
    const v0 = parseCapture(
      join(header(0), run(1, null, -0.001, 0.001, [0, 0.0005])),
      "digital_3.bin",
    );
    expect(v0.channels).toHaveLength(1);
    expect(v0.channels[0]!.name).toBe("D3");
    expect(edgesOf(v0, "D3")).toEqual([1_000_000, 1_500_000]);
    expect(v0.durationNs).toBe(2_000_000);

    const count = new Uint8Array(8);
    new DataView(count.buffer).setBigUint64(0, 2n, true);
    // The second chunk starts low after the first ended high, which is an edge at its start.
    const v1 = join(
      header(1),
      count,
      run(0, 1e6, 0, 0.001, [0.0002]),
      run(0, 1e6, 0.002, 0.003, [0.0025]),
    );
    const zipped = parseCapture(zipSync({ "export/digital_0.bin": v1 }), "export.zip");
    expect(zipped).toMatchObject({ sampleRateHz: 1e6 });
    expect(edgesOf(zipped, "D0")).toEqual([200_000, 2_000_000, 2_500_000]);
  });

  it("reads Saleae CSV exports and explains .sal", () => {
    const capture = parseCapture(
      strToU8("Time [s],TX,RX\n0.000000,1,1\n0.000010,0,1\n0.000030,1,0\n"),
      "digital.csv",
    );
    expect(edgesOf(capture, "TX")).toEqual([10_000, 30_000]);
    expect(edgesOf(capture, "RX")).toEqual([30_000]);
    expect(() => parseCapture(new Uint8Array(4), "session.sal")).toThrow("Export Raw Data");
  });
});

describe("capture decoding", () => {
  it("decodes UART bytes and reports levels and dense windows", () => {
    const capture = fromLevels(1000, { tx: uartLevels([0x41, 0x0a]) });
    const events = decodeUart(capture, "tx", { baud: 1_000_000 }, all);
    expect(events.map((event) => event.text)).toEqual(["0x41 'A'", "0x0a"]);
    // A range that starts after the first frame decodes only the second.
    expect(
      decodeUart(capture, "tx", { baud: 1_000_000 }, { ...all, fromNs: 12_000 }).map(
        (event) => event.text,
      ),
    ).toEqual(["0x0a"]);
    expect(levelAt(capture.channels[0]!, 2500)).toBe(0);
    const window = captureWindow(capture, 0, 30_000, 2);
    expect(window.channels[0]!.edges).toBeNull();
    expect(window.channels[0]!.busy!.length).toBeGreaterThan(0);
    expect(captureWindow(capture, 0, 30_000, 100).channels[0]!.edges!.length).toBeGreaterThan(2);
  });

  it("decodes SPI mode 0 words inside chip select", () => {
    // 0xA5 MSB first: data changes while the clock is low and is sampled on the rising edge.
    const bits = [1, 0, 1, 0, 0, 1, 0, 1] as Array<0 | 1>;
    const clk: Array<0 | 1> = [0, 0];
    const mosi: Array<0 | 1> = [0, 0];
    const cs: Array<0 | 1> = [1, 0];
    for (const bit of bits) {
      clk.push(0, 1);
      mosi.push(bit, bit);
      cs.push(0, 0);
    }
    clk.push(0);
    mosi.push(0);
    cs.push(1);
    const capture = fromLevels(100, { clk, mosi, cs });
    expect(
      decodeSpi(capture, { clk: "clk", mosi: "mosi", cs: "cs" }, all).map((event) => event.text),
    ).toEqual(["MOSI 0xa5"]);
  });

  it("decodes an I2C address write with ack", () => {
    // START, address 0x50 write (0xA0), ACK, STOP.
    const scl: Array<0 | 1> = [1, 1, 0];
    const sda: Array<0 | 1> = [1, 0, 0];
    for (const bit of [1, 0, 1, 0, 0, 0, 0, 0, 0] as Array<0 | 1>) {
      scl.push(0, 1, 0);
      sda.push(bit, bit, bit);
    }
    scl.push(1, 1);
    sda.push(0, 1);
    const capture = fromLevels(100, { scl, sda });
    expect(decodeI2c(capture, { sda: "sda", scl: "scl" }, all).map((event) => event.text)).toEqual([
      "start",
      "addr 0x50 write ack",
      "stop",
    ]);
  });
});
