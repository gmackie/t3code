import { describe, expect, it, vi } from "vitest";

import { GET_WS_URL_CHANNEL, registerDesktopWsUrlIpcHandler } from "./wsUrlIpc";

describe("registerDesktopWsUrlIpcHandler", () => {
  it("registers a sync listener that returns the current backend websocket url", () => {
    const removeAllListenersMock = vi.fn();
    const onMock = vi.fn();
    const getWsUrl = vi.fn(() => "ws://127.0.0.1:4242/?token=test-token");

    registerDesktopWsUrlIpcHandler(
      {
        removeAllListeners: removeAllListenersMock,
        on: onMock,
      },
      getWsUrl,
    );

    expect(removeAllListenersMock).toHaveBeenCalledTimes(1);
    expect(removeAllListenersMock).toHaveBeenCalledWith(GET_WS_URL_CHANNEL);
    expect(onMock).toHaveBeenCalledTimes(1);
    expect(onMock).toHaveBeenCalledWith(GET_WS_URL_CHANNEL, expect.any(Function));

    const listener = onMock.mock.calls[0]?.[1] as
      | ((event: { returnValue?: unknown }) => void)
      | undefined;
    const event: { returnValue?: unknown } = {};

    listener?.(event);

    expect(getWsUrl).toHaveBeenCalledTimes(1);
    expect(event.returnValue).toBe("ws://127.0.0.1:4242/?token=test-token");
  });
});
