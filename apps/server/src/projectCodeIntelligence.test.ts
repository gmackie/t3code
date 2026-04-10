import { describe, expect, it } from "vitest";
import {
  getProjectDefinitions,
  getProjectDocumentSymbols,
  getProjectHover,
} from "./projectCodeIntelligence";

describe("projectCodeIntelligence", () => {
  it("extracts heuristic symbols from TypeScript files", () => {
    const result = getProjectDocumentSymbols({
      workspaceRoot: "/repo",
      absolutePath: "/repo/src/example.ts",
      relativePath: "src/example.ts",
      contents: [
        "export interface Greeting {",
        "  message: string;",
        "}",
        "",
        "export function sayHello(name: string) {",
        "  return `hello ${name}`;",
        "}",
      ].join("\n"),
    });

    expect(result).toEqual({
      source: "typescript",
      symbols: expect.arrayContaining([
        expect.objectContaining({ name: "Greeting", kind: "interface" }),
        expect.objectContaining({ name: "sayHello", kind: "function" }),
      ]),
    });
  });

  it("resolves hover information from the nearest symbol on a line", () => {
    const result = getProjectHover({
      workspaceRoot: "/repo",
      absolutePath: "/repo/src/example.ts",
      relativePath: "src/example.ts",
      contents: [
        "export interface Greeting {",
        "  message: string;",
        "}",
        "",
        "export function sayHello(name: string) {",
        "  return `hello ${name}`;",
        "}",
      ].join("\n"),
      line: 5,
      column: 18,
    });

    expect(result).toEqual({
      source: "typescript",
      hover: expect.objectContaining({
        contents: expect.stringContaining("function sayHello"),
      }),
    });
  });

  it("resolves TypeScript definitions within the workspace", () => {
    const result = getProjectDefinitions({
      workspaceRoot: "/repo",
      absolutePath: "/repo/src/example.ts",
      relativePath: "src/example.ts",
      contents: [
        "export interface Greeting {",
        "  message: string;",
        "}",
        "",
        "export function sayHello(name: Greeting) {",
        "  return name.message;",
        "}",
      ].join("\n"),
      line: 5,
      column: 32,
    });

    expect(result).toEqual({
      source: "typescript",
      definitions: expect.arrayContaining([
        expect.objectContaining({
          relativePath: "src/example.ts",
          line: 1,
        }),
      ]),
    });
  });
});
