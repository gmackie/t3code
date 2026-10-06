import DOMPurify from "dompurify";
import mermaid from "mermaid";

const bridge = window as typeof window & {
  ReactNativeWebView?: { postMessage: (message: string) => void };
};
const report = (value: object) => bridge.ReactNativeWebView?.postMessage(JSON.stringify(value));
const config = JSON.parse(document.getElementById("diagram-source")!.textContent!) as {
  source: string;
  dark: boolean;
  expanded: boolean;
};

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  suppressErrorRendering: true,
  secure: [
    "secure",
    "securityLevel",
    "startOnLoad",
    "maxTextSize",
    "maxEdges",
    "suppressErrorRendering",
    "htmlLabels",
    "themeCSS",
  ],
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  theme: config.dark ? "dark" : "default",
  fontFamily: "system-ui, sans-serif",
});

async function render() {
  try {
    const { svg } = await mermaid.render("mermaid-diagram", config.source);
    const container = document.getElementById("diagram")!;
    container.innerHTML = DOMPurify.sanitize(svg, {
      ADD_TAGS: ["foreignObject"],
      HTML_INTEGRATION_POINTS: { foreignobject: true },
      USE_PROFILES: { svg: true, svgFilters: true, html: true },
      FORBID_TAGS: ["a", "img", "image", "script"],
      FORBID_ATTR: ["href", "xlink:href", "src", "srcset"],
    });
    const element = container.querySelector("svg")!;
    const bounds = element.viewBox.baseVal;
    if (!(bounds.width > 0 && bounds.height > 0)) throw new Error("Invalid diagram size");
    element.style.maxWidth = "none";
    element.style.width = "100%";
    element.style.height = "auto";
    if (!config.expanded) element.style.maxHeight = "360px";
    if (config.expanded) container.style.width = `${Math.max(bounds.width, innerWidth)}px`;
    const measure = () =>
      report({ type: "ready", height: Math.ceil(element.getBoundingClientRect().height) });
    new ResizeObserver(measure).observe(container);
    measure();
  } catch {
    report({ type: "error" });
  }
}
void render();
