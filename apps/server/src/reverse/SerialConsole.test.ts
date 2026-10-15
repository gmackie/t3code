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

  it("replays buffered output after a sequence number, then follows live output", () => {
    const output = new SerialOutput();
    output.push(Buffer.from("boot "));
    output.push(Buffer.from("ok\n"));
    const seen: string[] = [];
    const stop = output.observe(1, (chunk) =>
      seen.push(Buffer.from(chunk.data, "base64").toString()),
    );
    output.push(Buffer.from("> "));
    stop();
    output.push(Buffer.from("ignored"));
    expect(seen).toEqual(["ok\n", "> "]);
    expect(output.recent(6).toString()).toBe("ignored".slice(-6));
    expect(output.lastSeq).toBe(4);
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
    expect(() => serial.observe("p", "missing", 0, () => undefined)).toThrow("not open");
  });
});
