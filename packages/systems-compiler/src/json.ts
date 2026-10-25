import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import { error, type ModelDiagnostic } from "@t3tools/systems-model/diagnostics";

/**
 * RFC-001 §3.2 source rules and RFC 8785 (JCS) canonical bytes. Authoring JSON is
 * parsed strictly so duplicate keys, non-finite numbers and invalid Unicode are
 * diagnostics with a JSON Pointer, never silently resolved by `JSON.parse`.
 */

export interface StrictJson {
  readonly value?: unknown;
  readonly diagnostics: ReadonlyArray<ModelDiagnostic>;
}

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const MAX_DEPTH = 256;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

const escapePointer = (segment: string | number) =>
  String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
const toPointer = (path: ReadonlyArray<string | number>) =>
  path.map((segment) => `/${escapePointer(segment)}`).join("");

class Failure {
  readonly message: string;
  readonly path: ReadonlyArray<string | number>;
  constructor(message: string, path: ReadonlyArray<string | number>) {
    this.message = message;
    this.path = path;
  }
}

/** True when a string has no lone UTF-16 surrogate, i.e. it is valid Unicode. */
const isWellFormed = (text: string) => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
};

/** Parse one JSON document. Every duplicate key is reported; a syntax error stops the parse. */
export const parseStrictJson = (input: string | Uint8Array, file?: string): StrictJson => {
  const at = (message: string, path: ReadonlyArray<string | number>) =>
    error("E-SCHEMA-001", message, {
      ...(file === undefined ? {} : { file }),
      pointer: toPointer(path),
    });
  let text: string;
  try {
    text = typeof input === "string" ? input : decoder.decode(input);
  } catch {
    return { diagnostics: [at("Source is not valid UTF-8", [])] };
  }

  const duplicates: Array<ModelDiagnostic> = [];
  const path: Array<string | number> = [];
  let position = 0;

  const fail = (message: string): never => {
    throw new Failure(`${message} at offset ${position}`, [...path]);
  };
  const skipWhitespace = () => {
    while (position < text.length && " \t\n\r".includes(text[position]!)) position++;
  };
  const expect = (literal: string) => {
    if (!text.startsWith(literal, position)) fail(`Expected "${literal}"`);
    position += literal.length;
  };

  const parseString = (): string => {
    expect('"');
    let out = "";
    for (;;) {
      const char = text[position];
      if (char === undefined) return fail("Unterminated string");
      position++;
      if (char === '"') break;
      if (char < " ") fail("Unescaped control character in string");
      if (char !== "\\") {
        out += char;
        continue;
      }
      const escape = text[position++] ?? "";
      if (escape === "u") {
        const hex = text.slice(position, position + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("Invalid \\u escape");
        out += String.fromCharCode(Number.parseInt(hex, 16));
        position += 4;
      } else if (ESCAPES[escape] !== undefined) out += ESCAPES[escape];
      else fail(`Invalid escape "\\${escape}"`);
    }
    if (!isWellFormed(out)) fail("String contains a lone surrogate (invalid Unicode)");
    return out;
  };

  const parseValue = (depth: number): unknown => {
    if (depth > MAX_DEPTH) fail(`Nesting deeper than ${MAX_DEPTH}`);
    skipWhitespace();
    const char = text[position];
    if (char === "{") return parseObject(depth);
    if (char === "[") return parseArray(depth);
    if (char === '"') return parseString();
    if (text.startsWith("true", position)) return ((position += 4), true);
    if (text.startsWith("false", position)) return ((position += 5), false);
    if (text.startsWith("null", position)) return ((position += 4), null);
    if (/^-?(NaN|Infinity)/.test(text.slice(position, position + 9)))
      fail("NaN and Infinity are not JSON numbers");
    NUMBER.lastIndex = position;
    const match = NUMBER.exec(text);
    if (match === null) return fail("Unexpected token");
    position += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail(`Number ${match[0]} is outside the float64 range`);
    return value;
  };

  const parseObject = (depth: number) => {
    expect("{");
    const entries: Array<[string, unknown]> = [];
    const seen = new Set<string>();
    skipWhitespace();
    if (text[position] === "}") return (position++, {});
    for (;;) {
      skipWhitespace();
      const key = parseString();
      path.push(key);
      if (seen.has(key)) duplicates.push(at(`Duplicate key "${key}"`, path));
      seen.add(key);
      skipWhitespace();
      expect(":");
      entries.push([key, parseValue(depth + 1)]);
      path.pop();
      skipWhitespace();
      if (text[position] === ",") position++;
      else break;
    }
    expect("}");
    // `fromEntries` defines own properties, so a `__proto__` key stays data.
    return Object.fromEntries(entries);
  };

  const parseArray = (depth: number) => {
    expect("[");
    const items: Array<unknown> = [];
    skipWhitespace();
    if (text[position] === "]") return (position++, items);
    for (;;) {
      path.push(items.length);
      items.push(parseValue(depth + 1));
      path.pop();
      skipWhitespace();
      if (text[position] === ",") position++;
      else break;
    }
    expect("]");
    return items;
  };

  try {
    const value = parseValue(0);
    skipWhitespace();
    if (position < text.length) fail("Unexpected trailing content");
    return duplicates.length > 0 ? { diagnostics: duplicates } : { value, diagnostics: [] };
  } catch (cause) {
    if (!(cause instanceof Failure)) throw cause;
    return { diagnostics: [...duplicates, at(cause.message, cause.path)] };
  }
};

const escapeString = (text: string) => {
  if (!isWellFormed(text)) throw new TypeError("Cannot canonicalize a lone surrogate");
  let out = '"';
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (char === '"' || char === "\\") out += `\\${char}`;
    else if (code >= 0x20) out += char;
    else if (char === "\b") out += "\\b";
    else if (char === "\t") out += "\\t";
    else if (char === "\n") out += "\\n";
    else if (char === "\f") out += "\\f";
    else if (char === "\r") out += "\\r";
    else out += `\\u${code.toString(16).padStart(4, "0")}`;
  }
  return `${out}"`;
};

/**
 * RFC 8785 serialization: ECMAScript number formatting, members sorted by UTF-16 code
 * units, no whitespace. `undefined` members are omitted so optional fields stay absent.
 */
export const canonicalize = (value: unknown): string => {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError(`Cannot canonicalize ${value}`);
      return String(value);
    case "string":
      return escapeString(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
      const members = Object.entries(value)
        .filter(([, member]) => member !== undefined)
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, member]) => `${escapeString(key)}:${canonicalize(member)}`);
      return `{${members.join(",")}}`;
    }
    default:
      throw new TypeError(`Cannot canonicalize a ${typeof value}`);
  }
};

const encoder = new TextEncoder();

/** `sha256:<lowercase hex>` of the canonical bytes of `value` (RFC-001 §3.2). */
export const digest = Effect.fn("systemsCompiler.digest")(function* (value: unknown) {
  const crypto = yield* Crypto.Crypto;
  const bytes = yield* crypto
    .digest("SHA-256", encoder.encode(canonicalize(value)))
    .pipe(Effect.orDie);
  return `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
});
