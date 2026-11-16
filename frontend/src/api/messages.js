import { api } from "./client";

// GET /chats/{id}/messages
export async function listMessages(chatId, { limit = 50, before } = {}) {
  const params = { limit };
  if (before) params.before = before;
  const { data } = await api.get(`/chats/${chatId}/messages`, { params });
  return data.messages;
}

// POST /chats/{id}/messages
export async function sendMessage(chatId, body) {
  const { data } = await api.post(`/chats/${chatId}/messages`, body);
  return data;
}

export async function transcribeAttachment(chatId, messageId, attachmentId) {
  const { data } = await api.post(
    `/chats/${chatId}/messages/${messageId}/attachments/${attachmentId}/transcribe`,
  );
  return data;
}

// PUT /messages/{id}
export async function updateMessage(messageId, text) {
  const { data } = await api.put(`/messages/${messageId}`, { text });
  return data;
}

// DELETE /messages/{id}
export async function deleteMessage(messageId) {
  await api.delete(`/messages/${messageId}`);
}

export async function searchMessages(chatId, filters = {}) {
  const { data } = await api.get(`/chats/${chatId}/messages/search`, { params: filters });
  return data.messages || [];
}

export async function togglePin(chatId, messageId) {
  const { data } = await api.put(`/chats/${chatId}/messages/${messageId}/pin`);
  return data.pinned;
}

// POST /messages/{id}/reactions
export async function addReaction(messageId, emoji) {
  const { data } = await api.post(`/messages/${messageId}/reactions`, { emoji });
  return data;
}

// DELETE /messages/{id}/reactions
export async function removeReaction(messageId) {
  const { data } = await api.delete(`/messages/${messageId}/reactions`);
  return data;
}
