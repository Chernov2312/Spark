import { api } from "./client";

/* GET /chats → массив чатов */
export async function listChats() {
  const { data } = await api.get("/chats");
  return data.chats
}

/* POST /chats */
export async function createChat({
  title,
  description = "",
  invited_user_ids = [],
}) {
  const { data } = await api.post("/chats", {
    title,
    description,
    invited_user_ids,
  });
  return data;
}

/* PATCH /chats/{id} */
export async function updateChat(chatId, payload) {
  const { data } = await api.patch(`/chats/${chatId}`, payload);
  return data;
}

/* POST /chats/{id}/avatar */
export async function uploadChatAvatar(chatId, file) {
  const form = new FormData();
  form.append("avatar", file);
  const { data } = await api.post(`/chats/${chatId}/avatar`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

/* POST /chats/{id}/users */
export async function addUserToChat(chatId, userId) {
  const { data } = await api.post(`/chats/${chatId}/users`, {
    user_id: userId,
  });
  return data;
}

/* DELETE /chats/{id}/users/{user_id} */
export async function removeUserFromChat(chatId, userId) {
  await api.delete(`/chats/${chatId}/users/${userId}`);
}
