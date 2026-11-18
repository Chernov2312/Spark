import { api } from "./client";

export async function createPoll(chatId, payload) {
  const { data } = await api.post(`/chats/${chatId}/polls`, payload);
  return data;
}

export async function getPoll(pollId) {
  const { data } = await api.get(`/polls/${pollId}`);
  return data;
}

export async function vote(pollId, optionId) {
  const { data } = await api.put(`/polls/${pollId}/vote`, { option_id: optionId });
  return data;
}

export async function retractVote(pollId) {
  const { data } = await api.delete(`/polls/${pollId}/vote`);
  return data;
}
