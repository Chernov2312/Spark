import { api } from "./client";
import { getAvatarImageError, uploadToTemporaryUrl } from "./imageUpload";

/* GET /chats → массив чатов */
export async function listChats() {
  const { data } = await api.get("/chats");
  return data.chats;
}

/* POST /chats */
export async function createChat({
  id = null,
  title,
  description = "",
  invited_user_ids = [],
  avatar_urls = [],
}) {
  const { data } = await api.post("/chats", {
    id,
    title,
    description,
    invited_user_ids,
    avatar_urls,
  });
  return {
    ...data,
    avatar_urls: data.avatar_urls ?? data.avater_urls ?? [],
  };
}

/* PATCH /chats/{id} */
export async function updateChat(chatId, payload) {
  const { data } = await api.patch(`/chats/${chatId}`, payload);
  return data;
}

/* POST /chats/{id}/users */
export async function addUsersToChat(chatId, userIds) {
  const { data } = await api.post(`/chats/${chatId}/users`, {
    user_ids: userIds,
  });
  return data;
}

export async function getChatMembers(chatId) {
  const { data } = await api.get(`/chats/${chatId}/members`);
  return data;
}

export async function updateMemberRole(chatId, memberId, role) {
  const { data } = await api.put(`/chats/${chatId}/members/${memberId}/role`, { role });
  return data;
}

export async function markChatRead(chatId, messageId) {
  const { data } = await api.post(`/chats/${chatId}/read`, { message_id: messageId });
  return data;
}

export async function setPersonalChatAvatar(chatId, file) {
  const error = getAvatarImageError(file);
  if (error) throw new Error(error);
  const { fileKey } = await uploadToTemporaryUrl(api, file, {
    type: "personal_chat_avatar", targetId: chatId, maxSizeBytes: 5 * 1024 * 1024,
  });
  const { data } = await api.put(`/chats/${chatId}/personal-avatar`, { file_key: fileKey });
  return data;
}

export async function resetPersonalChatAvatar(chatId) {
  const { data } = await api.delete(`/chats/${chatId}/personal-avatar`);
  return data;
}

export async function searchUsersByUsername(username) {
  const { data } = await api.get("/users/search", {
    params: { username: username.trim(), limit: 20 },
  });
  return Array.isArray(data.users) ? data.users : [];
}

export async function uploadChatAvatars(chatId, files) {
  if (!chatId) throw new Error("Не удалось определить группу");

  const results = [];
  for (const file of files) {
    const fileError = getAvatarImageError(file);
    if (fileError) throw new Error(fileError);

    const { file: uploadFile, fileKey } = await uploadToTemporaryUrl(
      api,
      file,
      {
        type: "chat_avatar",
        targetId: chatId,
        maxSizeBytes: 5 * 1024 * 1024,
      },
    );
    const { data } = await api.post("/attachments/", {
      chat_id: chatId,
      is_avatar: true,
      file_key: fileKey,
      file_name: uploadFile.name,
      file_size: uploadFile.size,
      mime_type: uploadFile.type,
      text: null,
    });
    results.push(data);
  }
  return results;
}
