import { getToken, getValidAccessToken, refreshAccessToken } from "./client";

const CALLS_WS_URL = import.meta.env.VITE_CALLS_WS_URL?.trim();

export function callMediaUrl() {
  return new URL("/v1/calls/media", new URL(CALLS_WS_URL, window.location.href)).href;
}

export function callAudioConstraints() {
  // Chromium on Android keeps media volume routing when capture has no voice processing effects.
  const androidChromium = /\bAndroid\b.*\bChrom(?:e|ium)\//i.test(navigator.userAgent);
  return androidChromium ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : true;
}

export function createCallSocket({ onEvent, onStatus, inviteToken } = {}) {
  if (!CALLS_WS_URL) {
    onStatus?.("unconfigured");
    return {
      available: false,
      send: () => false,
      sendAuthorized: async () => false,
      close() {},
    };
  }

  if (!getToken() && !inviteToken) {
    onStatus?.("unauthorized");
    return {
      available: false,
      send: () => false,
      sendAuthorized: async () => false,
      close() {},
    };
  }

  let authenticated = false;
  let closedByClient = false;
  let authRejected = false;
  let reconnectTimer;
  let attempts = 0;
  let socket;
  let connectedToken;
  const reconnect = () => {
    reconnectTimer = setTimeout(connect, Math.min(500 * 2 ** attempts++, 15000));
  };
  const connect = async () => {
    if (closedByClient) return;
    let token;
    if (!inviteToken) {
      try {
        token = await getValidAccessToken();
      } catch {
        if (!closedByClient) {
          onStatus?.("error");
          reconnect();
        }
        return;
      }
      if (closedByClient) return;
      if (!token) {
        onStatus?.("unauthorized");
        return;
      }
    }
    try {
      const url = new URL(CALLS_WS_URL, window.location.href);
      if (url.protocol === "http:") url.protocol = "ws:";
      if (url.protocol === "https:") url.protocol = "wss:";
      socket = new WebSocket(url);
    } catch { onStatus?.("error"); return; }
    socket.onopen = () => {
      connectedToken = token;
      onStatus?.("authenticating");
      socket.send(JSON.stringify({
        event: "auth",
        data: {
          ...(inviteToken ? { invite_token: inviteToken } : { access_token: token }),
        },
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
      if (!inviteToken) reconnect();
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
    async sendAuthorized(event, data) {
      if (inviteToken) return this.send(event, data);
      const token = await getValidAccessToken();
      if (!token) return false;
      return this.send(event, token === connectedToken ? data : { ...data, access_token: token });
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
  const send = (token) => fetch(new URL("/v1/calls/" + path, url.origin), {
    method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const token = await getValidAccessToken();
  if (!token) throw new Error("Войдите в Spark.");
  let response = await send(token);
  if (response.status === 401) {
    const refreshedToken = await refreshAccessToken(token);
    if (refreshedToken) response = await send(refreshedToken);
  }
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
