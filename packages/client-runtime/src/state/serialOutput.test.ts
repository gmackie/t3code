import { describe, expect, it } from "vite-plus/test";
import { appendSerialChunk, EMPTY_SERIAL_OUTPUT } from "./serialOutput.ts";

const chunk = (seq: number, text: string) => ({ seq, data: btoa(text) });

describe("serial output", () => {
  it("appends new chunks in order and skips replayed ones", () => {
    const decoder = new TextDecoder();
    let state = appendSerialChunk(decoder, EMPTY_SERIAL_OUTPUT, chunk(1, "boot\n"));
    state = appendSerialChunk(decoder, state, chunk(2, "> "));
    state = appendSerialChunk(decoder, state, chunk(2, "> "));
    expect(state).toEqual({ text: "boot\n> ", lastSeq: 2 });
  });

  it("keeps only the tail of long output", () => {
    const state = appendSerialChunk(
      new TextDecoder(),
      EMPTY_SERIAL_OUTPUT,
      chunk(1, "x".repeat(70 * 1024)),
    );
    expect(state.text.length).toBe(64 * 1024);
  });

  it("keeps a character split across chunks within one console only", () => {
    const bytes = (...values: number[]) => ({ data: btoa(String.fromCharCode(...values)) });
    const first = new TextDecoder();
    const second = new TextDecoder();
    // Half of "€" (e2 82 ac) arrives on the first console; the second is unaffected.
    const a = appendSerialChunk(first, EMPTY_SERIAL_OUTPUT, { seq: 1, ...bytes(0xe2, 0x82) });
    const b = appendSerialChunk(second, EMPTY_SERIAL_OUTPUT, { seq: 1, ...bytes(0x3e, 0x20) });
    expect(b.text).toBe("> ");
    expect(appendSerialChunk(first, a, { seq: 2, ...bytes(0xac) }).text).toBe("€");
  });
});
