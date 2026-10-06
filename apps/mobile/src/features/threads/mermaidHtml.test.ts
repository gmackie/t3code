import { describe, expect, it } from "vite-plus/test";
import { mermaidHeight, mermaidHtml } from "./mermaidHtml";

describe("mobile Mermaid document", () => {
  it("round-trips diagram labels without allowing source to escape its data element", () => {
    const source = 'graph TD\nA["</script><script>alert(1)</script> & café"] --> B';
    const html = mermaidHtml("/* renderer */", source, true, false);
    const payload = html.match(/id="diagram-source">(.*?)<\/script>/)?.[1];
    expect(payload).toBeDefined();
    expect(JSON.parse(payload!)).toEqual({ source, dark: true, expanded: false });
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("bounds the inline layout while rejecting invalid bridge messages", () => {
    expect(mermaidHeight('{"type":"ready","height":240}')).toBe(240);
    expect(mermaidHeight('{"type":"ready","height":12}')).toBe(80);
    expect(mermaidHeight('{"type":"ready","height":20000}')).toBe(360);
    expect(mermaidHeight('{"type":"ready","height":-1}')).toBeNull();
    expect(mermaidHeight('{"type":"ready","height":1e999}')).toBeNull();
    expect(mermaidHeight('{"type":"ready","height":"240"}')).toBeNull();
    expect(mermaidHeight('{"type":"error"}')).toBeNull();
    expect(mermaidHeight("null")).toBeNull();
    expect(mermaidHeight("invalid")).toBeNull();
  });
});
