import { expect, it } from "vite-plus/test";

import source from "./SidebarChrome.tsx?raw";

it("keeps the Projects page reachable from desktop navigation", () => {
  expect(source).toContain('label="Projects"');
  expect(source).toContain('navigate({ to: "/projects" })');
});
