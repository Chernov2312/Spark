import { getToken } from "./client";

const CALLS_WS_URL = import.meta.env.VITE_CALLS_WS_URL?.trim();

export function createCallSocket({ onEvent, onStatus, inviteToken } = {}) {
  if (!CALLS_WS_URL) {
    onStatus?.("unconfigured");
    return {
      available: false,
      send: () => false,
      close() {},
    };
  }

  const token = getToken();
  if (!token && !inviteToken) {
    onStatus?.("unauthorized");
    return {
      available: false,
      send: () => false,
      close() {},
    };
  }

  let authenticated = false;
  let closedByClient = false;
  let authRejected = false;
  let reconnectTimer;
  let attempts = 0;
  let socket;
  const connect = () => {
    if (closedByClient) return;
    try {
      const url = new URL(CALLS_WS_URL, window.location.href);
      if (url.protocol === "http:") url.protocol = "ws:";
      if (url.protocol === "https:") url.protocol = "wss:";
      socket = new WebSocket(url);
    } catch { onStatus?.("error"); return; }
    socket.onopen = () => {
      onStatus?.("authenticating");
      socket.send(JSON.stringify({
        event: "auth",
        data: inviteToken ? { invite_token: inviteToken } : { access_token: token },
      }));
    };
    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data);
        if (payload.event === "auth:ok") {
          authenticated = true;
          attempts = 0;
        }
        if (payload.event === "auth:error") {
          authenticated = false;
          authRejected = true;
        }
        onEvent?.(payload.event, payload.data || {});
      } catch { onStatus?.("error"); }
    };
    socket.onerror = () => onStatus?.("error");
    socket.onclose = () => {
      authenticated = false;
      if (closedByClient || authRejected) return;
      onStatus?.("disconnected");
      if (!inviteToken) reconnectTimer = setTimeout(connect, Math.min(500 * 2 ** attempts++, 15000));
    };
  };
  queueMicrotask(connect);

  return {
    available: true,
    send(event, data) {
      if (!authenticated || socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(JSON.stringify({ event, data }));
      return true;
    },
    close() {
      closedByClient = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}

async function callRequest(path, method, body) {
  const url = new URL(CALLS_WS_URL, window.location.href);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  const response = await fetch(new URL("/v1/calls/" + path, url.origin), {
    method,
    headers: { Authorization: "Bearer " + getToken(), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Не удалось изменить приглашение.");
  return data;
}

export function createCallInvite(callId) {
  return callRequest(encodeURIComponent(callId) + "/invites", "POST", {});
}

export function revokeCallInvite(inviteId) {
  return callRequest("invites/" + encodeURIComponent(inviteId), "DELETE");
}
