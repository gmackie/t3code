import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

class CadQueryError extends Schema.TaggedError<CadQueryError>()("CadQueryError", {
  cause: Schema.Defect(),
}) {
  override get message() {
    return "Could not load the CAD project.";
  }
}

/** The standalone CAD page uses ticket-authenticated HTTP, outside the environment RPC runtime. */
export function cadQuery<A>(read: (signal: AbortSignal) => Promise<A>) {
  return Atom.make(
    Effect.tryPromise({
      try: read,
      catch: (cause) =>
        new CadQueryError({
          cause,
        }),
    }),
  );
}

export function createCachedCadReader(
  read: (url: string, signal: AbortSignal) => Promise<Response>,
) {
  const cache = new Map<string, Promise<string>>();
  return (url: string, signal: AbortSignal, revision: string) => {
    const key = `${revision}:${url}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = read(url, AbortSignal.any([signal, AbortSignal.timeout(60_000)])).then((response) =>
        response.text(),
      );
      cache.set(key, pending);
      void pending.catch(() => cache.delete(key));
      while (cache.size > 24) cache.delete(cache.keys().next().value!);
    }
    return pending;
  };
}

type CadReader = Parameters<typeof createCachedCadReader>[0];
type GerberRequest = { url: string; revision: string; adjacent: string[] };
const gerberFamilies = new WeakMap<
  CadReader,
  (key: string) => ReturnType<typeof cadQuery<string>>
>();

export function gerberSvgQuery(read: CadReader, target: GerberRequest) {
  let family = gerberFamilies.get(read);
  if (!family) {
    const load = createCachedCadReader(read);
    family = Atom.family((key: string) =>
      cadQuery(async (signal) => {
        const request = JSON.parse(key) as GerberRequest;
        const value = await load(request.url, signal, request.revision);
        // Preload at most the neighboring single layers after the visible layer is ready.
        for (const adjacent of request.adjacent) {
          if (signal.aborted) break;
          void load(adjacent, signal, request.revision).catch(() => {});
        }
        return value;
      }).pipe(Atom.setIdleTTL(60_000)),
    );
    gerberFamilies.set(read, family);
  }
  return family(JSON.stringify(target));
}
