import type { ReverseSerialChunk } from "@t3tools/contracts";

/** What a serial console shows: recent output as text, and the last chunk seen. */
export interface SerialOutputState {
  readonly text: string;
  readonly lastSeq: number;
}

export const EMPTY_SERIAL_OUTPUT: SerialOutputState = { text: "", lastSeq: 0 };
// The console keeps the tail; the full transcript stays on the environment.
const MAX_TEXT = 64 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: false });

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Appends one chunk, ignoring any already seen after a reconnect replays the buffer. */
export function appendSerialChunk(
  state: SerialOutputState,
  chunk: ReverseSerialChunk,
): SerialOutputState {
  if (chunk.seq <= state.lastSeq) return state;
  const text = state.text + decoder.decode(decodeBase64(chunk.data), { stream: true });
  return { text: text.length > MAX_TEXT ? text.slice(-MAX_TEXT) : text, lastSeq: chunk.seq };
}
