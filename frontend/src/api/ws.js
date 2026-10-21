import { getToken } from "./client";

const WS_ENABLED = import.meta.env.VITE_WS_ENABLED !== "false";

// VITE_API_URL = "https://sparkwork.dpdns.org/api/v1" в проде
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1";
const WS_BASE = API_URL
  .replace(/\/api\/v1\/?$/, "")
  .replace(/^http/, "ws"); // http->ws, https->wss

const noopSocket = { send() {}, close() {} };

export function createChatSocket(chatId, { onEvent, onOpen, onClose, onError } = {}) {
  if (!WS_ENABLED) {
    console.info("[WS] Отключён флагом VITE_WS_ENABLED=false");
    return noopSocket;
  }
  if (!chatId) {
    console.warn("[WS] Нет chatId — WebSocket не подключится");
    return noopSocket;
  }
  const token = getToken();
  if (!token) {
    console.warn("[WS] Нет токена — WebSocket не подключится");
    return noopSocket;
  }

  let socket = null;
  let closedByUs = false;
  let reconnectTimer = null;
  let attempt = 0;

  const connect = () => {
    const url = `${WS_BASE}/${chatId}/ws?token=${encodeURIComponent(token)}`;
    console.info("[WS] Подключаюсь:", url.replace(/token=[^&]+/, "token=***"));

    try {
      socket = new WebSocket(url);
    } catch (e) {
      console.warn("[WS] Не удалось создать сокет:", e.message);
      return;
    }

    socket.onopen = () => {
      console.info("[WS] Подключён");
      attempt = 0;
      onOpen?.();
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        onEvent?.(payload.event, payload.data);
      } catch (e) {
        console.error("[WS] Ошибка парсинга:", e, event.data);
      }
    };

    socket.onclose = (e) => {
      console.info("[WS] Соединение закрыто:", e.code, e.reason);
      onClose?.(e);
      if (closedByUs) return;
      // Экспоненциальная задержка: 1s, 2s, 4s, ... максимум 30s
      const delay = Math.min(1000 * 2 ** attempt++, 30000);
      console.info(`[WS] Переподключение через ${delay}ms`);
      reconnectTimer = setTimeout(connect, delay);
    };

    socket.onerror = () => onError?.();
  };

  connect();

  return {
    get socket() { return socket; },
    send(event, data) {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ event, data }));
      } else {
        console.warn("[WS] Не отправлено, сокет не открыт:", event);
      }
    },
    close() {
      closedByUs = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}