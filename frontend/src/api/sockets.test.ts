import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatSocket } from "./ws";

vi.mock("./client", () => ({ API_BASE: "/api/v1", getToken: () => "test-token" }));

const opened = vi.fn();
class TestSocket {
  onclose: ((event: CloseEvent) => void) | null = null;
  close = vi.fn();

  constructor() {
    opened(this);
  }
}

describe("WebSocket lifecycle", () => {
  beforeEach(() => {
    opened.mockClear();
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubEnv("VITE_CALLS_WS_URL", "/v1/calls/ws");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("skips obsolete chat sockets and ignores an intentional close", async () => {
    const onClose = vi.fn();
    createChatSocket("chat", { onClose }).close();
    const current = createChatSocket("chat", { onClose });
    await Promise.resolve();
    expect(opened).toHaveBeenCalledTimes(1);
    current.close();
    const socket: TestSocket = opened.mock.calls[0][0];
    expect(socket.close).toHaveBeenCalledOnce();
    socket.onclose?.(new CloseEvent("close", { code: 1006 }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("skips obsolete call sockets before the handshake starts", async () => {
    const { createCallSocket } = await import("./calls");
    createCallSocket().close();
    const current = createCallSocket();
    await Promise.resolve();
    expect(opened).toHaveBeenCalledTimes(1);
    current.close();
    expect(opened.mock.calls[0][0].close).toHaveBeenCalledOnce();
  });
});
