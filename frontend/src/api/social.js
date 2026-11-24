import { api } from "./client";

export async function listFriends() {
  const { data } = await api.get("/friends");
  return {
    friends: Array.isArray(data.friends) ? data.friends : [],
    requests: Array.isArray(data.requests) ? data.requests : [],
    sentRequests: Array.isArray(data.sent_requests) ? data.sent_requests : [],
    categories: Array.isArray(data.categories) ? data.categories : [],
  };
}

export async function requestFriend(friendId) {
  const { data } = await api.post(`/friends/${friendId}/request`);
  return data;
}

export async function acceptFriend(friendId) {
  const { data } = await api.post(`/friends/${friendId}/accept`);
  return data;
}

export async function removeFriend(friendId) {
  await api.delete(`/friends/${friendId}`);
}

export async function createFriendCategory(name) {
  const { data } = await api.post("/friends/categories", { name });
  return data;
}

export async function setFriendCategory(friendId, categoryId) {
  const { data } = await api.patch(`/friends/${friendId}/category`, {
    category_id: categoryId || null,
  });
  return data;
}

export async function listChatFolders() {
  const { data } = await api.get("/chat-folders");
  return Array.isArray(data.folders) ? data.folders : [];
}

export async function createChatFolder(name) {
  const { data } = await api.post("/chat-folders", { name });
  return data;
}

export async function setChatFolder(chatId, folderId) {
  const { data } = await api.patch(`/chats/${chatId}/folder`, {
    folder_id: folderId || null,
  });
  return data;
}
