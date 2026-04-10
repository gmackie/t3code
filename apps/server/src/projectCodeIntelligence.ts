import path from "node:path";
import type {
  ProjectCodeDefinition,
  ProjectCodeDefinitionsResult,
  ProjectCodeDocumentSymbol,
  ProjectCodeDocumentSymbolsResult,
  ProjectCodeHoverResult,
  ProjectCodeIntelligenceSource,
  ProjectCodeSymbolKind,
} from "@t3tools/contracts";
import ts from "typescript";

function normalizeExtension(relativePath: string): string {
  return path.extname(relativePath).toLowerCase();
}

function isTypescriptFamilyFile(relativePath: string): boolean {
  const extension = normalizeExtension(relativePath);
  return (
    extension === ".ts" ||
    extension === ".tsx" ||
    extension === ".js" ||
    extension === ".jsx" ||
    extension === ".mts" ||
    extension === ".cts" ||
    extension === ".mjs" ||
    extension === ".cjs"
  );
}

function makeRange(line: number, lineText: string, column: number) {
  const boundedColumn = Math.max(1, Math.min(column, lineText.length + 1));
  return {
    start: { line, column: boundedColumn },
    end: {
      line,
      column: Math.max(boundedColumn, lineText.trimEnd().length + 1),
    },
  };
}

function pushSymbol(
  symbols: ProjectCodeDocumentSymbol[],
  input: {
    line: number;
    lineText: string;
    name: string;
    kind: ProjectCodeSymbolKind;
    selectionColumn: number;
  },
) {
  symbols.push({
    name: input.name,
    kind: input.kind,
    range: makeRange(input.line, input.lineText, 1),
    selectionRange: makeRange(input.line, input.lineText, input.selectionColumn),
  });
}

function parseMarkdownSymbols(lines: readonly string[]): ProjectCodeDocumentSymbol[] {
  const symbols: ProjectCodeDocumentSymbol[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index] ?? "";
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lineText);
    if (!match) continue;
    pushSymbol(symbols, {
      line: index + 1,
      lineText,
      kind: "heading",
      name: match[2] ?? "Heading",
      selectionColumn: (match[1]?.length ?? 0) + 2,
    });
  }
  return symbols;
}

function parsePythonSymbols(lines: readonly string[]): ProjectCodeDocumentSymbol[] {
  const symbols: ProjectCodeDocumentSymbol[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index] ?? "";
    const classMatch = /^\s*class\s+([A-Za-z_][\w]*)/.exec(lineText);
    if (classMatch?.[1]) {
      pushSymbol(symbols, {
        line: index + 1,
        lineText,
        kind: "class",
        name: classMatch[1],
        selectionColumn: Math.max(1, lineText.indexOf(classMatch[1]) + 1),
      });
      continue;
    }

    const functionMatch = /^\s*def\s+([A-Za-z_][\w]*)/.exec(lineText);
    if (functionMatch?.[1]) {
      pushSymbol(symbols, {
        line: index + 1,
        lineText,
        kind: "function",
        name: functionMatch[1],
        selectionColumn: Math.max(1, lineText.indexOf(functionMatch[1]) + 1),
      });
    }
  }
  return symbols;
}

function parseRustSymbols(lines: readonly string[]): ProjectCodeDocumentSymbol[] {
  const symbols: ProjectCodeDocumentSymbol[] = [];
  const patterns: Array<{ kind: ProjectCodeSymbolKind; regex: RegExp }> = [
    { kind: "module", regex: /^\s*(?:pub\s+)?mod\s+([A-Za-z_][\w]*)/ },
    { kind: "struct", regex: /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/ },
    { kind: "enum", regex: /^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/ },
    { kind: "trait", regex: /^\s*(?:pub\s+)?trait\s+([A-Za-z_][\w]*)/ },
    { kind: "constant", regex: /^\s*(?:pub\s+)?const\s+([A-Za-z_][\w]*)/ },
    { kind: "function", regex: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)/ },
  ];

  for (let index = 0; index < lines.length; index += 1) {
    const lineText = lines[index] ?? "";
    for (const pattern of patterns) {
      const match = pattern.regex.exec(lineText);
      const name = match?.[1];
      if (!name) continue;
      pushSymbol(symbols, {
        line: index + 1,
        lineText,
        kind: pattern.kind,
        name,
        selectionColumn: Math.max(1, lineText.indexOf(name) + 1),
      });
      break;
    }
  }

  return symbols;
}

function offsetFromLineColumn(contents: string, line: number, column: number): number | null {
  if (line < 1 || column < 1) {
    return null;
  }

  const lines = contents.split(/\r?\n/);
  const lineText = lines[line - 1];
  if (lineText === undefined) {
    return null;
  }

  let offset = 0;
  for (let index = 0; index < line - 1; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1;
  }

  return offset + Math.min(column - 1, lineText.length);
}

function lineColumnFromOffset(contents: string, offset: number): { line: number; column: number } {
  const boundedOffset = Math.max(0, Math.min(offset, contents.length));
  let line = 1;
  let column = 1;

  for (let index = 0; index < boundedOffset; index += 1) {
    if (contents[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

function rangeFromTextSpan(contents: string, textSpan: ts.TextSpan) {
  const start = lineColumnFromOffset(contents, textSpan.start);
  const end = lineColumnFromOffset(contents, textSpan.start + textSpan.length);
  return { start, end };
}

function relativePathWithinWorkspace(workspaceRoot: string, absolutePath: string): string | null {
  const relativePath = path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");
  if (
    relativePath.length === 0 ||
    relativePath === "." ||
    relativePath.startsWith("../") ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath;
}

function mapNavigationKind(kind: string): ProjectCodeSymbolKind {
  switch (kind) {
    case "class":
      return "class";
    case "interface":
      return "interface";
    case "enum":
      return "enum";
    case "type":
    case "type alias":
      return "type";
    case "function":
      return "function";
    case "method":
    case "memberFunction":
      return "method";
    case "var":
    case "let":
      return "variable";
    case "const":
      return "constant";
    case "module":
      return "module";
    default:
      return "variable";
  }
}

function flattenNavigationTree(
  contents: string,
  item: ts.NavigationTree,
  symbols: ProjectCodeDocumentSymbol[],
) {
  if (item.text !== "<global>" && item.kind !== "script" && item.spans[0]) {
    const firstSpan = item.spans[0];
    const range = rangeFromTextSpan(contents, firstSpan);
    symbols.push({
      name: item.text,
      kind: mapNavigationKind(item.kind),
      range,
      selectionRange: range,
    });
  }

  for (const child of item.childItems ?? []) {
    flattenNavigationTree(contents, child, symbols);
  }
}

function createTypeScriptLanguageService(input: {
  workspaceRoot: string;
  absolutePath: string;
  contents: string;
}) {
  const configPath =
    ts.findConfigFile(path.dirname(input.absolutePath), ts.sys.fileExists, "tsconfig.json") ??
    ts.findConfigFile(input.workspaceRoot, ts.sys.fileExists, "tsconfig.json");

  let fileNames = [input.absolutePath];
  let compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
  };
  let currentDirectory = input.workspaceRoot;

  if (configPath) {
    const parsedConfig = ts.getParsedCommandLineOfConfigFile(
      configPath,
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => undefined,
      },
    );
    if (parsedConfig) {
      compilerOptions = {
        ...compilerOptions,
        ...parsedConfig.options,
      };
      fileNames = Array.from(new Set([...parsedConfig.fileNames, input.absolutePath]));
      currentDirectory = path.dirname(configPath);
    }
  }

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getCurrentDirectory: () => currentDirectory,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    getScriptFileNames: () => fileNames,
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) => {
      if (path.resolve(fileName) === path.resolve(input.absolutePath)) {
        return ts.ScriptSnapshot.fromString(input.contents);
      }
      if (!ts.sys.fileExists(fileName)) {
        return undefined;
      }
      const text = ts.sys.readFile(fileName);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    fileExists: ts.sys.fileExists,
    readDirectory: ts.sys.readDirectory,
    readFile: ts.sys.readFile,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  };

  return ts.createLanguageService(host, ts.createDocumentRegistry());
}

function getTypeScriptDocumentSymbols(input: {
  workspaceRoot: string;
  absolutePath: string;
  relativePath: string;
  contents: string;
}): ProjectCodeDocumentSymbolsResult | null {
  try {
    const service = createTypeScriptLanguageService(input);
    const navigationTree = service.getNavigationTree(input.absolutePath);
    const symbols: ProjectCodeDocumentSymbol[] = [];
    flattenNavigationTree(input.contents, navigationTree, symbols);
    service.dispose();
    return {
      source: "typescript",
      symbols,
    };
  } catch {
    return null;
  }
}

function getTypeScriptHover(input: {
  workspaceRoot: string;
  absolutePath: string;
  relativePath: string;
  contents: string;
  line: number;
  column: number;
}): ProjectCodeHoverResult | null {
  try {
    const position = offsetFromLineColumn(input.contents, input.line, input.column);
    if (position === null) {
      return null;
    }
    const service = createTypeScriptLanguageService(input);
    const info = service.getQuickInfoAtPosition(input.absolutePath, position);
    service.dispose();
    if (!info) {
      return {
        source: "typescript",
        hover: null,
      };
    }

    const summary = ts.displayPartsToString(info.displayParts ?? []);
    const documentation = ts.displayPartsToString(info.documentation ?? []);
    const contents = documentation ? `${summary}\n\n${documentation}` : summary;

    return {
      source: "typescript",
      hover: {
        contents,
        range: rangeFromTextSpan(input.contents, info.textSpan),
      },
    };
  } catch {
    return null;
  }
}

function getTypeScriptDefinitions(input: {
  workspaceRoot: string;
  absolutePath: string;
  relativePath: string;
  contents: string;
  line: number;
  column: number;
}): ProjectCodeDefinitionsResult | null {
  try {
    const position = offsetFromLineColumn(input.contents, input.line, input.column);
    if (position === null) {
      return null;
    }
    const service = createTypeScriptLanguageService(input);
    const definitions = service.getDefinitionAtPosition(input.absolutePath, position) ?? [];
    const mappedDefinitions: ProjectCodeDefinition[] = [];
    for (const definition of definitions) {
      const relativePath = relativePathWithinWorkspace(input.workspaceRoot, definition.fileName);
      if (!relativePath) {
        continue;
      }
      const definitionContents =
        path.resolve(definition.fileName) === path.resolve(input.absolutePath)
          ? input.contents
          : (ts.sys.readFile(definition.fileName) ?? "");
      const definitionPosition = lineColumnFromOffset(
        definitionContents,
        definition.textSpan.start,
      );
      mappedDefinitions.push({
        relativePath,
        line: definitionPosition.line,
        column: definitionPosition.column,
      });
    }
    service.dispose();
    return {
      source: "typescript",
      definitions: mappedDefinitions,
    };
  } catch {
    return null;
  }
}

function fallbackDocumentSymbols(input: {
  relativePath: string;
  contents: string;
}): ProjectCodeDocumentSymbolsResult {
  const lines = input.contents.split(/\r?\n/);
  const extension = normalizeExtension(input.relativePath);

  let source: ProjectCodeIntelligenceSource = "none";
  let symbols: ProjectCodeDocumentSymbol[] = [];

  if (extension === ".md" || extension === ".mdx") {
    source = "heuristic";
    symbols = parseMarkdownSymbols(lines);
  } else if (extension === ".py") {
    source = "heuristic";
    symbols = parsePythonSymbols(lines);
  } else if (extension === ".rs") {
    source = "heuristic";
    symbols = parseRustSymbols(lines);
  }

  return {
    source,
    symbols,
  };
}

export function getProjectDocumentSymbols(input: {
  workspaceRoot: string;
  absolutePath: string;
  relativePath: string;
  contents: string;
}): ProjectCodeDocumentSymbolsResult {
  if (isTypescriptFamilyFile(input.relativePath)) {
    const typescriptResult = getTypeScriptDocumentSymbols(input);
    if (typescriptResult) {
      return typescriptResult;
    }
  }

  return fallbackDocumentSymbols(input);
}

export function getProjectHover(input: {
  workspaceRoot: string;
  absolutePath: string;
  relativePath: string;
  contents: string;
  line: number;
  column: number;
}): ProjectCodeHoverResult {
  if (isTypescriptFamilyFile(input.relativePath)) {
    const typescriptResult = getTypeScriptHover(input);
    if (typescriptResult) {
      return typescriptResult;
    }
  }

  const symbolResult = getProjectDocumentSymbols(input);
  const matchingSymbol = symbolResult.symbols.find(
    (symbol) =>
      symbol.selectionRange.start.line === input.line &&
      input.column >= symbol.selectionRange.start.column,
  );

  if (!matchingSymbol) {
    return {
      source: symbolResult.source,
      hover: null,
    };
  }

  return {
    source: symbolResult.source,
    hover: {
      contents: `${matchingSymbol.kind} ${matchingSymbol.name}`,
      range: matchingSymbol.selectionRange,
    },
  };
}

export function getProjectDefinitions(input: {
  workspaceRoot: string;
  absolutePath: string;
  relativePath: string;
  contents: string;
  line: number;
  column: number;
}): ProjectCodeDefinitionsResult {
  if (isTypescriptFamilyFile(input.relativePath)) {
    const typescriptResult = getTypeScriptDefinitions(input);
    if (typescriptResult) {
      return typescriptResult;
    }
  }

  return {
    source: "none",
    definitions: [],
  };
}
