import { getToken } from "./client";

const WS_ENABLED = import.meta.env.VITE_WS_ENABLED !== "false";

const WS_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8000/api/v1")
  .replace(/^http/, "ws")
  .replace("/api/v1", "");

/* Пустышка — возвращается, когда WS отключён или не подключился */
const noopSocket = {
  send() {},
  sendMessage() {},
  sendTyping() {},
  close() {},
};

export function createChatSocket({ onEvent, onOpen, onClose, onError } = {}) {
  if (!WS_ENABLED) {
    console.info("[WS] Отключён флагом VITE_WS_ENABLED=false");
    return noopSocket;
  }

  const token = getToken();
  if (!token) {
    console.warn("[WS] Нет токена — WebSocket не подключится");
    return noopSocket;
  }

  let socket;
  try {
    socket = new WebSocket(`${WS_BASE}/ws?token=${token}`);
  } catch (e) {
    console.warn("[WS] Не удалось создать сокет:", e.message);
    return noopSocket;
  }

  socket.onopen = () => {
    console.info("[WS] Подключён");
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
  };

  socket.onerror = () => {
    // Не спамим в консоль — ошибку всё равно видно по onclose
    onError?.();
  };

  return {
    socket,
    send(event, data) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ event, data }));
      }
    },
    sendMessage(chatId, text) {
      this.send("message:send", { chat_id: chatId, text });
    },
    sendTyping(chatId) {
      this.send("chat:typing", { chat_id: chatId });
    },
    close() {
      socket.close();
    },
  };
}
