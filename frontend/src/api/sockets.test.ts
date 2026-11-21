import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatSocket } from "./ws";

const { getValidAccessToken } = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(),
}));
vi.mock("./client", () => ({ API_BASE: "/api/v1", getToken: () => "test-token", getValidAccessToken }));

const opened = vi.fn();
class TestSocket {
  onopen: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  close = vi.fn();
  send = vi.fn();
  readyState = 1;
  static OPEN = 1;

  constructor(url: string) {
    opened(this, url);
  }
}

describe("WebSocket lifecycle", () => {
  beforeEach(() => {
    opened.mockClear();
    getValidAccessToken.mockReset().mockReturnValue("test-token");
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
    await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
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
    await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    current.close();
    expect(opened.mock.calls[0][0].close).toHaveBeenCalledOnce();
  });

  it("waits for a renewed access token before opening the chat connection", async () => {
    getValidAccessToken.mockResolvedValue("updated-token");
    const current = createChatSocket("chat");
    await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(opened.mock.calls[0][1]).toContain("token=updated-token&");
    current.close();
  });

  it("sends updated credentials for a call action on an existing connection", async () => {
    const { createCallSocket } = await import("./calls");
    const current = createCallSocket();
    await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    const socket: TestSocket = opened.mock.calls[0][0];
    socket.onopen?.();
    socket.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ event: "auth:ok" }) }));
    getValidAccessToken.mockResolvedValue("updated-token");
    expect(await current.sendAuthorized("call:start", { chat_id: "chat", media: "audio" })).toBe(true);
    expect(JSON.parse(socket.send.mock.lastCall![0])).toEqual({
      event: "call:start", data: { chat_id: "chat", media: "audio", access_token: "updated-token" },
    });
    current.close();
  });
});
