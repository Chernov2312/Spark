import { api } from "./client";
import { uploadToTemporaryUrl } from "./imageUpload";

/* Obtain a presigned URL, upload directly to storage, then register metadata. */
export async function uploadAttachment(file, chatId, { compressImages = true } = {}) {
  const rawUser = localStorage.getItem("user");
  const user = rawUser ? JSON.parse(rawUser) : null;
  if (!user?.id) {
    throw new Error("Не удалось определить текущего пользователя");
  }
  if (!chatId) {
    throw new Error("Не удалось определить чат для вложения");
  }

  const { file: uploadFile, fileKey } = await uploadToTemporaryUrl(
    api,
    file,
    {
      type: "message",
      targetId: user.id,
      compress: compressImages,
    },
  );

  try {
    const { data } = await api.post("/attachments/", {
      chat_id: chatId,
      file_key: fileKey,
      file_name: uploadFile.name,
      file_size: uploadFile.size,
      mime_type: uploadFile.type || "application/octet-stream",
      text: null,
    });
    return {
      ...data,
      file_key: fileKey,
      file_name: data.file_name ?? uploadFile.name,
      file_size: data.file_size ?? uploadFile.size,
      mime_type: data.mime_type ?? uploadFile.type,
      text: data.text ?? null,
    };
  } catch (error) {
    const detail = error.response?.data?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((item) => item.msg).filter(Boolean).join("; ")
          : error.message;
    throw new Error(
      message || "Файл загружен, но сервер не зарегистрировал вложение",
      { cause: error },
    );
  }
}

export async function getAttachmentDownloadUrl(attachmentId, { signal } = {}) {
  const { data } = await api.get(`/attachments/${attachmentId}/download`, { signal });
  return data.url;
}
