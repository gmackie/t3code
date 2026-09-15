// @effect-diagnostics globalDate:off globalDateInEffect:off globalErrorInEffectCatch:off globalErrorInEffectFailure:off
import * as NodeCrypto from "node:crypto";
import { kiCadLibraryCache } from "./KiCadLibrary.ts";
import { kiCadBomCache } from "./KiCadBom.ts";
import { kiCadModelCache } from "./KiCadModel.ts";
import { discoverKiCadProject, resolveKiCadProjectFile } from "./KiCadProject.ts";
import { renderPrismGerber, renderPrismGerberComposite } from "./PrismGerber.ts";
import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpServerRespondable,
} from "effect/unstable/http";
import { authenticateRawRouteWithScope } from "../http.ts";

const KICAD_ROUTE_PREFIX = "/api/kicad";
const kicadViewerSessions = new Map<
  string,
  { readonly cwd: string; readonly expiresAt: number; readonly canOperate: boolean }
>();
export const kicadViewerSession = (url: URL) => {
  const token = url.searchParams.get("token");
  const session = token ? kicadViewerSessions.get(token) : undefined;
  return session && session.expiresAt > Date.now() ? session : undefined;
};
const kicadSessionCwd = (url: URL): string | undefined => {
  const token = url.searchParams.get("token");
  if (!token) return undefined;
  const session = kicadViewerSessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    kicadViewerSessions.delete(token);
    return undefined;
  }
  return session.cwd;
};

export const kicadViewerSessionRouteLayer = HttpRouter.add(
  "POST",
  `${KICAD_ROUTE_PREFIX}/viewer-session`,
  Effect.gen(function* () {
    const authorization = yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const cwd = url.value.searchParams.get("cwd");
    if (!cwd) return HttpServerResponse.text("Missing cwd", { status: 400 });
    const fileSystem = yield* FileSystem.FileSystem;
    const canonical = yield* fileSystem.realPath(cwd);
    const token = NodeCrypto.randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 60 * 60_000;
    for (const [oldToken, session] of kicadViewerSessions) {
      if (session.expiresAt <= Date.now()) kicadViewerSessions.delete(oldToken);
    }
    kicadViewerSessions.set(token, {
      cwd: canonical,
      expiresAt,
      canOperate: authorization.scopes.includes(AuthOrchestrationOperateScope),
    });
    return yield* HttpServerResponse.json(
      { token, expiresAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);

export const kicadModelRouteLayer = HttpRouter.add(
  "GET",
  `${KICAD_ROUTE_PREFIX}/model`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const sessionCwd = kicadSessionCwd(url.value);
    if (!sessionCwd) yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
    const cwd = sessionCwd ?? url.value.searchParams.get("cwd");
    const requestedPath = url.value.searchParams.get("path");
    if (!cwd || !requestedPath)
      return HttpServerResponse.text("Missing cwd or path", { status: 400 });
    const manifest = yield* Effect.tryPromise(() => discoverKiCadProject(cwd));
    const asset = yield* Effect.tryPromise(() => resolveKiCadProjectFile(cwd, requestedPath));
    if (!asset || asset.file.kind !== "pcb")
      return HttpServerResponse.text("PCB file not found", { status: 404 });
    const outputPath = yield* Effect.tryPromise({
      try: () => kiCadModelCache.get(asset.absolutePath, manifest.revision),
      catch: (cause) =>
        new Error(
          `KiCad GLB export failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
    });
    return yield* HttpServerResponse.file(outputPath, {
      headers: {
        "Content-Type": "model/gltf-binary",
        "Cache-Control": "private, max-age=600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.text(
          error instanceof Error ? error.message : "KiCad GLB export failed",
          { status: 502 },
        ),
      ),
    ),
  ),
);

export const kicadGerberRouteLayer = HttpRouter.add(
  "GET",
  `${KICAD_ROUTE_PREFIX}/gerber`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const sessionCwd = kicadSessionCwd(url.value);
    if (!sessionCwd) yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
    const cwd = sessionCwd ?? url.value.searchParams.get("cwd");
    const requestedPaths = url.value.searchParams.getAll("path");
    if (!cwd || requestedPaths.length === 0)
      return HttpServerResponse.text("Missing cwd or path", { status: 400 });
    if (requestedPaths.length > 32)
      return HttpServerResponse.text("Too many Gerber layers selected", { status: 400 });
    const assets = yield* Effect.tryPromise(() =>
      Promise.all(requestedPaths.map((path) => resolveKiCadProjectFile(cwd, path))),
    );
    if (
      assets.some(
        (asset, index) =>
          !asset ||
          asset.file.kind !== "gerber" ||
          asset.file.size > 16 * 1024 * 1024 ||
          requestedPaths[index]!.toLowerCase().endsWith(".gbrjob"),
      )
    )
      return HttpServerResponse.text("Gerber file not found or not renderable", { status: 404 });
    const fileSystem = yield* FileSystem.FileSystem;
    const content = yield* Effect.all(
      assets.map((asset) => fileSystem.readFileString(asset!.absolutePath)),
    );
    const totalBytes = content.reduce((sum, value) => sum + Buffer.byteLength(value, "utf8"), 0);
    if (totalBytes > 16 * 1024 * 1024)
      return HttpServerResponse.text("Selected Gerber layers exceed the 16 MiB limit", {
        status: 413,
      });
    const svg = yield* Effect.tryPromise({
      try: () =>
        content.length === 1
          ? renderPrismGerber(content[0]!, assets[0]!.file.path)
          : renderPrismGerberComposite(
              content.map((value, index) => ({
                content: value,
                filename: assets[index]!.file.path,
              })),
            ),
      catch: (error) =>
        new Error(
          `Gerber rendering failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
    });
    return HttpServerResponse.text(svg, {
      contentType: "image/svg+xml",
      headers: {
        "Cache-Control": "private, no-cache",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
    Effect.catch((error) =>
      Effect.succeed(
        HttpServerResponse.text(
          error instanceof Error ? error.message : "Gerber rendering failed",
          { status: 502 },
        ),
      ),
    ),
  ),
);

/** Authenticated, read-only access to the active project's KiCad sources and generated outputs. */
export const kicadProjectRouteLayer = HttpRouter.add(
  "GET",
  `${KICAD_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const sessionCwd = kicadSessionCwd(url.value);
    if (!sessionCwd) yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
    const cwd = sessionCwd ?? url.value.searchParams.get("cwd");
    if (!cwd) return HttpServerResponse.text("Missing cwd", { status: 400 });
    const suffix = url.value.pathname.slice(`${KICAD_ROUTE_PREFIX}/`.length);
    if (suffix === "manifest") {
      return yield* HttpServerResponse.json(
        yield* Effect.tryPromise(() => discoverKiCadProject(cwd)),
      );
    }
    if (suffix === "library") {
      const path = url.value.searchParams.get("path");
      if (!path) return HttpServerResponse.text("Missing path", { status: 400 });
      const asset = yield* Effect.tryPromise(() => resolveKiCadProjectFile(cwd, path));
      if (!asset || (asset.file.kind !== "footprint" && asset.file.kind !== "symbol"))
        return HttpServerResponse.text("Library not found", { status: 404 });
      const kind = asset.file.kind;
      const manifest = yield* Effect.tryPromise(() => discoverKiCadProject(cwd));
      return yield* Effect.tryPromise(() =>
        kiCadLibraryCache.get(kind, asset.absolutePath, manifest.revision),
      ).pipe(
        Effect.flatMap((members) => HttpServerResponse.json(members)),
        Effect.catch((cause) =>
          Effect.succeed(
            HttpServerResponse.text(
              `KiCad library export failed: ${cause instanceof Error ? cause.message : String(cause)}`,
              { status: 422 },
            ),
          ),
        ),
      );
    }
    if (suffix === "bom") {
      const path = url.value.searchParams.get("path");
      if (!path) return HttpServerResponse.text("Missing path", { status: 400 });
      const asset = yield* Effect.tryPromise(() => resolveKiCadProjectFile(cwd, path));
      if (asset?.file.kind !== "schematic")
        return HttpServerResponse.text("Schematic not found", { status: 404 });
      const manifest = yield* Effect.tryPromise(() => discoverKiCadProject(cwd));
      return yield* Effect.tryPromise(() =>
        kiCadBomCache.get(cwd, asset.file.path, manifest.revision),
      ).pipe(
        Effect.flatMap((bom) => HttpServerResponse.json(bom)),
        Effect.catch((cause) =>
          Effect.succeed(
            HttpServerResponse.text(
              `KiCad BOM export failed: ${cause instanceof Error ? cause.message : String(cause)}`,
              { status: 422 },
            ),
          ),
        ),
      );
    }
    if (suffix === "assets") {
      const path = url.value.searchParams.get("path");
      if (!path) return HttpServerResponse.text("Missing path", { status: 400 });
      const asset = yield* Effect.tryPromise(() => resolveKiCadProjectFile(cwd, path));
      if (!asset) return HttpServerResponse.text("Not Found", { status: 404 });
      return yield* HttpServerResponse.file(asset.absolutePath, {
        headers: {
          "Cache-Control": "private, no-cache",
          "Content-Type": asset.file.mimeType,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return HttpServerResponse.text("Not Found", { status: 404 });
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);
