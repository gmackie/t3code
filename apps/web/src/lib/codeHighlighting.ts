import {
  getSharedHighlighter,
  type DiffsHighlighter,
  type SupportedLanguages,
} from "@pierre/diffs";

import { basenameOfPath, resolveLanguageIdForPath } from "../vscode-icons";
import { resolveDiffThemeName, type DiffThemeName, fnv1a32 } from "./diffRendering";
import { LRUCache } from "./lruCache";

const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;
const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;

const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);
const highlightedCodePromiseCache = new Map<string, Promise<string>>();
const highlighterPromiseCache = new Map<string, Promise<DiffsHighlighter>>();

const PATH_LANGUAGE_OVERRIDES: Record<string, string> = {
  dockerfile: "dockerfile",
  ".env": "ini",
  ".env.example": "ini",
  ".gitignore": "ini",
  ".npmrc": "ini",
  ".prettierrc": "json",
  ".prettierrc.json": "json",
  ".eslintrc": "json",
  ".eslintrc.json": "json",
};

const LANGUAGE_ID_TO_SHIKI_LANGUAGE: Record<string, string> = {
  plaintext: "text",
  text: "text",
  shellscript: "bash",
  javascriptreact: "jsx",
  typescriptreact: "tsx",
  jsonc: "json",
  dockercompose: "yaml",
  properties: "ini",
  dotenv: "ini",
};

function createHighlightCacheKey(code: string, language: string, themeName: DiffThemeName): string {
  return `${fnv1a32(code).toString(36)}:${code.length}:${language}:${themeName}`;
}

function estimateHighlightedSize(html: string, code: string): number {
  return Math.max(html.length * 2, code.length * 3);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderPlainTextHtml(code: string): string {
  const lines = code.split("\n");
  const htmlLines = lines.map((line) => `<span class="line">${escapeHtml(line)}</span>`).join("\n");
  return `<pre class="shiki t3code-plain" tabindex="0"><code>${htmlLines}</code></pre>`;
}

export function extractFenceLanguage(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  const raw = match?.[1] ?? "text";
  return raw === "gitignore" ? "ini" : raw;
}

export function resolveCodeLanguageFromPath(pathValue: string): string {
  const basename = basenameOfPath(pathValue).toLowerCase();
  const override = PATH_LANGUAGE_OVERRIDES[basename];
  if (override) {
    return override;
  }

  const languageId = resolveLanguageIdForPath(pathValue);
  if (!languageId) {
    return "text";
  }

  return LANGUAGE_ID_TO_SHIKI_LANGUAGE[languageId] ?? languageId;
}

export function resolveCodeThemeName(theme: "light" | "dark"): DiffThemeName {
  return resolveDiffThemeName(theme);
}

export function getHighlighterPromise(language: string): Promise<DiffsHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [language as SupportedLanguages],
    preferredHighlighter: "shiki-js",
  }).catch(() => {
    highlighterPromiseCache.delete(language);
    if (language === "text") {
      throw new Error("Unable to initialize text highlighter.");
    }
    return getHighlighterPromise("text");
  });

  highlighterPromiseCache.set(language, promise);
  return promise;
}

export function getHighlightedCodeHtmlPromise(input: {
  code: string;
  language: string;
  themeName: DiffThemeName;
  isStreaming?: boolean;
}): Promise<string> {
  const cacheKey = createHighlightCacheKey(input.code, input.language, input.themeName);
  if (!input.isStreaming) {
    const cachedHtml = highlightedCodeCache.get(cacheKey);
    if (cachedHtml != null) {
      return Promise.resolve(cachedHtml);
    }

    const cachedPromise = highlightedCodePromiseCache.get(cacheKey);
    if (cachedPromise) {
      return cachedPromise;
    }
  }

  const promise = getHighlighterPromise(input.language)
    .then((highlighter: DiffsHighlighter) => {
      try {
        return highlighter.codeToHtml(input.code, {
          lang: input.language,
          theme: input.themeName,
        });
      } catch {
        return highlighter.codeToHtml(input.code, {
          lang: "text",
          theme: input.themeName,
        });
      }
    })
    .catch(() => renderPlainTextHtml(input.code))
    .then((html: string) => {
      if (!input.isStreaming) {
        highlightedCodeCache.set(cacheKey, html, estimateHighlightedSize(html, input.code));
      }
      return html;
    })
    .finally(() => {
      if (!input.isStreaming) {
        highlightedCodePromiseCache.delete(cacheKey);
      }
    });

  if (!input.isStreaming) {
    highlightedCodePromiseCache.set(cacheKey, promise);
  }

  return promise;
}
