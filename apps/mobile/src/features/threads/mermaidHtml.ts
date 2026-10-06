/** Inline all assets so diagrams work offline and across remote environments. */
export function mermaidHtml(script: string, source: string, dark: boolean, expanded: boolean) {
  const payload = JSON.stringify({ source, dark, expanded }).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1${expanded ? "" : ", user-scalable=no"}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"><style>html,body{margin:0;background:${dark ? "#18181b" : "#fff"};color:${dark ? "#fafafa" : "#18181b"};font-family:system-ui,sans-serif}#diagram{width:100%}svg{display:block}*{animation:none!important;transition:none!important}</style></head><body><div id="diagram"></div><script type="application/json" id="diagram-source">${payload}</script><script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}

/** Only accept finite layout messages, and bound each inline WebView's height. */
export function mermaidHeight(message: string): number | null {
  try {
    const value: unknown = JSON.parse(message);
    return typeof value === "object" &&
      value !== null &&
      "type" in value &&
      value.type === "ready" &&
      "height" in value &&
      typeof value.height === "number" &&
      Number.isFinite(value.height) &&
      value.height > 0
      ? Math.max(80, Math.min(360, value.height))
      : null;
  } catch {
    return null;
  }
}
