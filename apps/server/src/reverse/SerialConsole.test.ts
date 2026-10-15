// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { listSerialPorts, SerialConsole, SerialOutput } from "./SerialConsole.ts";

describe("serial console", () => {
  it("lists only serial adapters for the host platform", async () => {
    const dev = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-dev-"));
    try {
      for (const name of [
        "cu.usbserial-1410",
        "tty.usbserial-1410",
        "cu.Bluetooth-Incoming-Port",
        "ttyUSB0",
        "ttyACM1",
        "ttyS0",
        "sda",
      ])
        await NodeFSP.writeFile(NodePath.join(dev, name), "");
      expect(await listSerialPorts("darwin", dev)).toEqual([
        NodePath.join(dev, "cu.usbserial-1410"),
      ]);
      expect(await listSerialPorts("linux", dev)).toEqual([
        NodePath.join(dev, "ttyACM1"),
        NodePath.join(dev, "ttyUSB0"),
      ]);
      expect(await listSerialPorts("win32", dev)).toEqual([]);
    } finally {
      await NodeFSP.rm(dev, { recursive: true, force: true });
    }
  });

  it("replays missed output as one chunk, follows live output, and ends with the session", () => {
    const output = new SerialOutput();
    output.push(Buffer.from("boot "));
    output.push(Buffer.from("ok\n"));
    output.push(Buffer.from("> "));
    const seen: Array<[number, string]> = [];
    let ended = false;
    const stop = output.observe(
      1,
      (chunk) => seen.push([chunk.seq, Buffer.from(chunk.data, "base64").toString()]),
      () => {
        ended = true;
      },
    );
    output.push(Buffer.from("x"));
    output.end();
    output.push(Buffer.from("ignored"));
    stop();
    expect(seen).toEqual([
      [3, "ok\n> "],
      [4, "x"],
    ]);
    expect(ended).toBe(true);
    expect(output.recent(3).toString()).toBe("> x");
    // A late observer still gets what was buffered, then the end.
    let lateEnded = false;
    output.observe(
      3,
      () => undefined,
      () => {
        lateEnded = true;
      },
    );
    expect(lateEnded).toBe(true);
  });

  it("refuses devices that are not listed serial ports", async () => {
    const serial = new SerialConsole(NodeOS.tmpdir(), "linux");
    await expect(serial.open("p", "/dev/sda", 115200)).rejects.toMatchObject({
      reason: "not_found",
    });
    await expect(
      new SerialConsole(NodeOS.tmpdir(), "win32").open("p", "COM3", 9600),
    ).rejects.toMatchObject({
      reason: "unavailable",
    });
    expect(() =>
      serial.observe(
        "p",
        "missing",
        0,
        () => undefined,
        () => undefined,
      ),
    ).toThrow("not open");
  });
});
