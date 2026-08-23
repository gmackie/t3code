import { expect, it } from "vite-plus/test";
import source from "./ChatComposer.tsx?raw";

it("renders exactly one desktop composer footer", () => {
  expect(source.match(/data-chat-composer-footer="true"/g)).toHaveLength(1);
});
