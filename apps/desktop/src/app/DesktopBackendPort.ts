import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as NetService from "@t3tools/shared/Net";

export const findDesktopBackendPort = Effect.fn("findDesktopBackendPort")(function* (input: {
  readonly startPort: number;
  readonly maxPort: number;
  readonly hosts: ReadonlyArray<string>;
}) {
  const net = yield* NetService.NetService;
  for (let port = input.startPort; port <= input.maxPort; port += 1) {
    if (!(yield* net.isPortAvailableOnLoopback(port))) continue;

    let availableOnEveryHost = true;
    for (const host of input.hosts) {
      if (!(yield* net.canListenOnHost(port, host))) {
        availableOnEveryHost = false;
        break;
      }
    }
    if (availableOnEveryHost) return Option.some(port);
  }
  return Option.none<number>();
});
