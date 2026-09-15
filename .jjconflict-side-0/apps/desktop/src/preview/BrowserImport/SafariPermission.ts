import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { safariAccessGranted } from "./SafariCookies.ts";

const safariCookieJar = (home: string, profileDirectory?: string): string =>
  profileDirectory === undefined
    ? `${home}/Library/Containers/com.apple.Safari/Data/Library/Cookies/Cookies.binarycookies`
    : `${home}/Library/Containers/com.apple.Safari/Data/Library/WebKit/WebsiteDataStore/${profileDirectory}/Cookies/Cookies.binarycookies`;

export const safariPermissionCheck = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const env = yield* HostProcessEnvironment;
  const platform = yield* HostProcessPlatform;
  const services = yield* Effect.context<FileSystem.FileSystem>();
  const runPromise = Effect.runPromiseWith(services);
  const check = Effect.gen(function* () {
    if (platform !== "darwin") return false;
    const home = env.HOME;
    if (home === undefined || home === "") return false;
    const defaultJar = safariCookieJar(home);
    if (yield* safariAccessGranted(defaultJar)) return true;
    const storeRoot = `${home}/Library/Containers/com.apple.Safari/Data/Library/WebKit/WebsiteDataStore`;
    const entries = yield* fs.readDirectory(storeRoot).pipe(Effect.orElseSucceed(() => []));
    for (const entry of entries) {
      const jar = safariCookieJar(home, entry);
      if (yield* safariAccessGranted(jar)) return true;
    }
    return false;
  });
  return () => runPromise(check);
});
