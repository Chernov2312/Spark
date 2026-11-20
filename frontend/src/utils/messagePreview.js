import { maskMessageSpoilers } from "./messageLinks";

export function messageTimestamp(value) {
  if (!value) return 0;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  return Date.parse(normalized) || 0;
}

export function messageContentPreview(message) {
  const text = summarizeMessageText(message.text);
  const attachments = message.attachments || [];
  let content = message.poll_id ? `Опрос: ${text || "Голосование"}` : text;
  if (!content) {
    if (attachments.length > 1) content = `Вложения: ${attachments.length}`;
    else if (attachments[0]?.mime_type?.startsWith("image/")) content = "Фото";
    else if (attachments[0]?.mime_type?.startsWith("video/")) content = "Видео";
    else if (attachments[0]?.mime_type?.startsWith("audio/")) content = "Голосовое сообщение";
    else content = attachments[0]?.file_name || "Вложение";
  }
  return content;
}

export function summarizeMessageText(text) {
  return text ? maskMessageSpoilers(text).replace(/\s+/g, " ").trim() : "";
}

export function messagePreview(message) {
  if (!message) return "Нет сообщений";
  const content = messageContentPreview(message);
  if (message.is_forwarded) return `Переслано: ${content}`;
  return message.thread_root_id ? `В треде: ${content}` : content;
}
