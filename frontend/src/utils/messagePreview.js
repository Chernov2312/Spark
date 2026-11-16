export function messageTimestamp(value) {
  if (!value) return 0;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  return Date.parse(normalized) || 0;
}

export function messagePreview(message) {
  if (!message) return "Нет сообщений";
  const text = message.text?.replace(/\s+/g, " ").trim();
  const attachments = message.attachments || [];
  let content = text;
  if (!content) {
    if (attachments.length > 1) content = `Вложения: ${attachments.length}`;
    else if (attachments[0]?.mime_type?.startsWith("image/")) content = "Фото";
    else if (attachments[0]?.mime_type?.startsWith("video/")) content = "Видео";
    else if (attachments[0]?.mime_type?.startsWith("audio/")) content = "Голосовое сообщение";
    else content = attachments[0]?.file_name || "Вложение";
  }
  return message.thread_root_id ? `В треде: ${content}` : content;
}
