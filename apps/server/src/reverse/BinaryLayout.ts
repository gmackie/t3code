export interface BinarySegment { offset: number; fileSize: number; virtualAddress: string; memorySize: string; executable: boolean; writable: boolean }
export interface BinaryLayout {
  format: "elf" | "raw-or-unsupported"; bits?: number; endian?: string; machine?: number;
  segments: BinarySegment[]; posture: Record<string, string>;
}
/** Header observations only. Runtime MPU, secure boot, ASLR and canaries need separate evidence. */
export function inspectBinary(bytes: Uint8Array): BinaryLayout {
  const unknown: BinaryLayout = { format: "raw-or-unsupported", segments: [], posture: { runtimeMemoryProtection: "unknown", stackCanary: "unknown", secureBoot: "unknown" } };
  if (bytes.length < 64 || bytes[0] !== 127 || bytes[1] !== 69 || bytes[2] !== 76 || bytes[3] !== 70) return unknown;
  const bits = bytes[4] === 2 ? 64 : bytes[4] === 1 ? 32 : 0, little = bytes[5] === 1;
  if (!bits || ![1,2].includes(bytes[5]!)) throw new Error("Invalid ELF class or byte order");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, little), u32 = (at: number) => view.getUint32(at, little);
  const u64 = (at: number) => view.getBigUint64(at, little);
  const ph = bits === 64 ? u64(32) : BigInt(u32(28)), size = u16(bits === 64 ? 54 : 42), count = u16(bits === 64 ? 56 : 44);
  if (count > 1024 || size < (bits === 64 ? 56 : 32) || ph + BigInt(size * count) > BigInt(bytes.length)) throw new Error("ELF program headers exceed file bounds");
  const segments: BinarySegment[] = []; let stack = "not-declared", relro = "not-declared";
  for (let i = 0; i < count; i++) {
    const at = Number(ph) + size * i, type = u32(at), flags = u32(at + (bits === 64 ? 4 : 24));
    if (type === 0x6474e551) stack = flags & 1 ? "executable-requested" : "non-executable-requested";
    if (type === 0x6474e552) relro = "segment-present; binding mode not evaluated";
    if (type !== 1) continue;
    const offset = bits === 64 ? u64(at + 8) : BigInt(u32(at + 4));
    const address = bits === 64 ? u64(at + 16) : BigInt(u32(at + 8));
    const length = bits === 64 ? u64(at + 32) : BigInt(u32(at + 16));
    const memory = bits === 64 ? u64(at + 40) : BigInt(u32(at + 20));
    if (offset + length > BigInt(bytes.length) || length > memory) throw new Error("ELF load segment exceeds file bounds");
    segments.push({ offset: Number(offset), fileSize: Number(length), virtualAddress: `0x${address.toString(16)}`, memorySize: memory.toString(), executable: Boolean(flags & 1), writable: Boolean(flags & 2) });
  }
  return { format: "elf", bits, endian: little ? "little" : "big", machine: u16(18), segments, posture: { ...unknown.posture, gnuStack: stack, relro, relocation: u16(16) === 3 ? "ET_DYN; not proof of PIE or ASLR" : "not-ET_DYN" } };
}
export function addressToFileOffset(layout: BinaryLayout, address: string): number | null {
  const target = BigInt(address);
  for (const segment of layout.segments) {
    const delta = target - BigInt(segment.virtualAddress);
    if (delta >= 0n && delta < BigInt(segment.fileSize)) return segment.offset + Number(delta);
  }
  return null;
}
