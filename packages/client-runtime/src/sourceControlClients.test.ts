import { describe, expect, it } from "vite-plus/test";

import { sourceControlClients } from "./sourceControlClients.ts";

describe("sourceControlClients", () => {
  it("routes ForgeGraph change request URLs to ForgeGraph, not the generic Forgejo host", () => {
    const kindOf = (url: string) => sourceControlClients.findByChangeRequestUrl(url)?.kind;
    expect(kindOf("https://git.forgegraf.com/acme/web/pulls/7")).toBe("forgegraph");
    expect(kindOf("https://codeberg.org/acme/web/pulls/7")).toBe("forgejo");
  });
});
