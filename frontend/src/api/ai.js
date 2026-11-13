import { api } from "./client";

export async function summarizeChat(chatId, limit = 30) {
  const { data } = await api.post(`/ai/chats/${chatId}/summarize`, undefined, {
    params: { limit },
  });
  return data;
}

export async function askChatAssistant(chatId, question, limit = 30) {
  const { data } = await api.post(`/ai/chats/${chatId}/assistant`, {
    question,
    limit,
  });
  return data;
}
