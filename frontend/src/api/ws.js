import { getToken } from "./client";

const WS_BASE = (import.meta.env.VITE_API_URL || "http://localhost:8080/api/v1")
  .replace(/^http/, "ws")
  .replace("/api/v1", "");

export function createChatSocket({ onEvent, onOpen, onClose, onError } = {}) {
  const token = getToken();
  if (!token) throw new Error("Нет токена — WebSocket не подключится");

  const socket = new WebSocket(`${WS_BASE}/ws?token=${token}`);

  socket.onopen = () => onOpen?.();
  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      onEvent?.(payload.event, payload.data);
    } catch (e) {
      console.error("WS parse error", e, event.data);
    }
  };
  socket.onclose = (e) => onClose?.(e);
  socket.onerror = (e) => onError?.(e);

  return {
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
