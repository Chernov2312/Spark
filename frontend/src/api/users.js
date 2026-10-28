import { api } from "./client";
import { getAvatarImageError, uploadToTemporaryUrl } from "./imageUpload";

/* Бэкенд отдаёт avatar_urls как массив строк.
   Последний элемент = текущий аватар. */
function extractUrl(data) {
  if (!data) return null;

  const raw =
    (Array.isArray(data.avatar_urls) && data.avatar_urls.length
      ? data.avatar_urls
      : null) ??
    data.avatar_url ??
    data.url ??
    null;
  if (!raw) return null;

  // Массив — берём последний
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw[raw.length - 1] : null;
  }

  return typeof raw === "string" ? raw : null;
}

function extractFileKey(url) {
  if (!url) return null;

  try {
    const segments = new URL(url, window.location.origin).pathname
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
    return segments.length >= 3 ? segments.slice(-3).join("/") : null;
  } catch {
    return null;
  }
}

export async function getMe() {
  const { data } = await api.get("/users/me");
  const url = extractUrl(data);
  return {
    ...data,
    avatar_url: url, // строка — для <img src>
    avatar_file_key: extractFileKey(url),
  };
}

export async function updateMe(payload) {
  const { data } = await api.patch("/users/me", payload);
  const url = extractUrl(data);
  const normalized = {
    ...data,
    avatar_url: url,
    avatar_file_key: extractFileKey(url),
  };

  const raw = localStorage.getItem("user");
  if (raw) {
    const user = JSON.parse(raw);
    localStorage.setItem(
      "user",
      JSON.stringify({
        ...user,
        username: normalized.username ?? user.username,
        email: normalized.email ?? user.email,
      }),
    );
    window.dispatchEvent(new Event("spark:auth-change"));
  }

  return normalized;
}

export async function uploadAvatar(file) {
  const fileError = getAvatarImageError(file);
  if (fileError) throw new Error(fileError);

  const user = getCurrentUserData();
  if (!user?.id) {
    throw new Error("Не удалось определить текущего пользователя");
  }

  const { file: uploadFile, fileKey } = await uploadToTemporaryUrl(
    api,
    file,
    {
      type: "user_avatar",
      targetId: user.id,
      maxSizeBytes: 5 * 1024 * 1024,
    },
  );

  let data;
  try {
    ({ data } = await api.post("/attachments/", {
      chat_id: null,
      is_avatar: true,
      file_key: fileKey,
      file_name: uploadFile.name,
      file_size: uploadFile.size,
      mime_type: uploadFile.type,
      text: null,
    }));
  } catch (error) {
    const detail = error.response?.data?.detail;
    const message =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((item) => item.msg).filter(Boolean).join("; ")
          : error.message;
    throw new Error(
      message ||
        "Файл загружен, но сервер не зарегистрировал его как аватар",
      { cause: error },
    );
  }

  const url = data.attachment_url;
  if (!url) {
    throw new Error("Сервер не вернул ссылку на загруженный аватар");
  }
  return {
    avatar_url: url,
    avatar_file_key: fileKey,
  };
}

export async function deleteAvatar(fileKey) {
  const { data } = await api.post("/users/me/delete/avatar", {
    url: fileKey,
  });
  return data;
}

function getCurrentUserData() {
  const raw = localStorage.getItem("user");
  return raw ? JSON.parse(raw) : null;
}
