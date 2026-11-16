import { getToken } from "./client";

const CALLS_WS_URL = import.meta.env.VITE_CALLS_WS_URL?.trim();

export function createCallSocket({ onEvent, onStatus } = {}) {
  if (!CALLS_WS_URL) {
    onStatus?.("unconfigured");
    return {
      available: false,
      send: () => false,
      close() {},
    };
  }

  const token = getToken();
  if (!token) {
    onStatus?.("unauthorized");
    return {
      available: false,
      send: () => false,
      close() {},
    };
  }

  let authenticated = false;
  let closedByClient = false;
  const socket = new WebSocket(CALLS_WS_URL);

  socket.onopen = () => {
    onStatus?.("authenticating");
    socket.send(
      JSON.stringify({
        event: "auth",
        data: { access_token: token },
      }),
    );
  };

  socket.onmessage = (message) => {
    try {
      const payload = JSON.parse(message.data);
      if (payload.event === "auth:ok") authenticated = true;
      if (payload.event === "auth:error") authenticated = false;
      onEvent?.(payload.event, payload.data || {});
    } catch {
      onStatus?.("error");
    }
  };

  socket.onerror = () => onStatus?.("error");
  socket.onclose = () => {
    authenticated = false;
    if (!closedByClient) onStatus?.("disconnected");
  };

  return {
    available: true,
    send(event, data) {
      if (!authenticated || socket.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ event, data }));
      return true;
    },
    close() {
      closedByClient = true;
      socket.close();
    },
  };
}
