import { assert, describe, it } from "@effect/vitest";
import * as Redacted from "effect/Redacted";

import { resolveForgeGraphCredential } from "./ForgeGraphCredentials.ts";
import { forgeGraphServerOrigin, parseForgeGraphRemote } from "./forgeGraphHosts.ts";

const settings = (serverUrl = "", token = "") => ({ serverUrl, token });

const chosen = (input: Parameters<typeof resolveForgeGraphCredential>[0]) => {
  const { server, credential } = resolveForgeGraphCredential(input);
  return {
    server,
    source: credential?.source ?? null,
    token: credential === null ? null : Redacted.value(credential.token),
  };
};

describe("resolveForgeGraphCredential", () => {
  it("prefers the token saved in T3, then FG_API_TOKEN, then the forge CLI's", () => {
    const cli = { token: "fg_cli", server: "https://forgegraf.com" };
    const env = { FG_API_TOKEN: "fg_env" };
    assert.deepStrictEqual(chosen({ settings: settings("", "fg_saved"), env, cli }), {
      server: "https://forgegraf.com",
      source: "settings",
      token: "fg_saved",
    });
    assert.strictEqual(chosen({ settings: settings(), env, cli }).source, "env");
    assert.strictEqual(chosen({ settings: settings(), env: {}, cli }).source, "forge-cli");
    assert.strictEqual(chosen({ settings: settings(), env: {}, cli: null }).source, null);
  });

  it("never sends a token to a server other than the one its source names", () => {
    // A server configured in Settings gets neither the production env token nor the CLI's.
    assert.deepStrictEqual(
      chosen({
        settings: settings("https://forge.example.test"),
        env: { FG_API_TOKEN: "fg_env" },
        cli: { token: "fg_cli", server: "https://forgegraf.com" },
      }),
      { server: "https://forge.example.test", source: null, token: null },
    );
    // FG_SERVER pairs FG_API_TOKEN with its own server.
    assert.deepStrictEqual(
      chosen({
        settings: settings(),
        env: { FG_SERVER: "forge.example.test", FG_API_TOKEN: "fg_env" },
        cli: { token: "fg_cli" },
      }),
      { server: "https://forge.example.test", source: "env", token: "fg_env" },
    );
  });

  it("follows the forge CLI's server when nothing else names one", () => {
    assert.deepStrictEqual(
      chosen({
        settings: settings(),
        env: {},
        cli: { token: " fg_cli ", server: "https://forge.example.test/" },
      }),
      { server: "https://forge.example.test", source: "forge-cli", token: "fg_cli" },
    );
  });
});

describe("parseForgeGraphRemote", () => {
  it("reads owner/repo from either git host over https and ssh", () => {
    for (const url of [
      "https://git.forgegraf.com/gmackie/t3code.git",
      "https://gitgw.forgegraf.com/gmackie/t3code",
      "git@git.forgegraf.com:gmackie/t3code.git",
      "ssh://git@gitgw.forgegraf.com:2222/gmackie/t3code.git",
    ])
      assert.strictEqual(parseForgeGraphRemote(url)?.repository, "gmackie/t3code", url);
  });

  it("claims nothing off ForgeGraph's git hosts or deeper than owner/repo", () => {
    for (const url of [
      "https://github.com/gmackie/t3code.git",
      "https://forgegraf.com/gmackie/t3code.git",
      "https://git.forgegraf.com.evil.test/gmackie/t3code.git",
      "https://git.forgegraf.com/group/sub/repo.git",
    ])
      assert.isNull(parseForgeGraphRemote(url), url);
  });

  it("follows a configured server's git hosts", () => {
    assert.strictEqual(
      parseForgeGraphRemote("https://git.forge.example.test/a/b.git", "https://forge.example.test")
        ?.repository,
      "a/b",
    );
    assert.isNull(forgeGraphServerOrigin("ftp://forgegraf.com"));
    assert.strictEqual(forgeGraphServerOrigin("forgegraf.com"), "https://forgegraf.com");
  });
});
