import { describe, expect, it } from "vite-plus/test";
import { appendSerialChunk, EMPTY_SERIAL_OUTPUT } from "./serialOutput.ts";

const chunk = (seq: number, text: string) => ({ seq, data: btoa(text) });

describe("serial output", () => {
  it("appends new chunks in order and skips replayed ones", () => {
    let state = appendSerialChunk(EMPTY_SERIAL_OUTPUT, chunk(1, "boot\n"));
    state = appendSerialChunk(state, chunk(2, "> "));
    state = appendSerialChunk(state, chunk(2, "> "));
    expect(state).toEqual({ text: "boot\n> ", lastSeq: 2 });
  });

  it("keeps only the tail of long output", () => {
    const state = appendSerialChunk(EMPTY_SERIAL_OUTPUT, chunk(1, "x".repeat(70 * 1024)));
    expect(state.text.length).toBe(64 * 1024);
  });
});
