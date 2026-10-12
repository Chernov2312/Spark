import { api } from "./client";

/* GET /chats/{id}/messages?limit=50&before=...
   Универсально: если бэкенд отдаёт массив — берём его,
   если объект { messages: [...] } — берём .messages */
export async function listMessages(chatId, { limit = 50, before } = {}) {
  const params = { limit };
  if (before) params.before = before;
  const { data } = await api.get(`/chats/${chatId}/messages`, { params });
  return Array.isArray(data) ? data : data.messages || [];
}

/* POST /chats/{id}/messages — { text } */
export async function sendMessage(chatId, text) {
  const { data } = await api.post(`/chats/${chatId}/messages`, { text });
  return data;
}

/* PUT /messages/{id} — { text } */
export async function updateMessage(messageId, text) {
  const { data } = await api.put(`/messages/${messageId}`, { text });
  return data;
}

/* DELETE /messages/{id} */
export async function deleteMessage(messageId) {
  await api.delete(`/messages/${messageId}`);
}

/* POST /messages/{id}/reactions — { emoji } */
export async function addReaction(messageId, emoji) {
  const { data } = await api.post(`/messages/${messageId}/reactions`, {
    emoji,
  });
  return data;
}

/* DELETE /messages/{id}/reactions */
export async function removeReaction(messageId) {
  const { data } = await api.delete(`/messages/${messageId}/reactions`);
  return data;
}
