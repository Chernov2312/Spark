import { api } from "./client";
import { getAvatarImageError, uploadToTemporaryUrl } from "./imageUpload";

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

function normalizeUser(data) {
  if (!data) return data;

  const avatarUrls = Array.isArray(data.avatar_urls)
    ? data.avatar_urls.filter((url) => typeof url === "string" && url)
    : [];
  const urls = avatarUrls.length > 0
    ? avatarUrls
    : typeof data.avatar_url === "string" && data.avatar_url
      ? [data.avatar_url]
      : typeof data.url === "string" && data.url
        ? [data.url]
        : [];
  const avatars = urls.map((url) => ({ url, file_key: extractFileKey(url) }));
  const currentAvatar = avatars.at(-1) ?? null;

  return {
    ...data,
    avatar_urls: urls,
    avatars,
    avatar_url: currentAvatar?.url ?? null,
    avatar_file_key: currentAvatar?.file_key ?? null,
  };
}

export async function getMe() {
  const { data } = await api.get("/users/me");
  return normalizeUser(data);
}

export async function updateMe(payload) {
  const { data } = await api.patch("/users/me", payload);
  const normalized = normalizeUser(data);

  const raw = localStorage.getItem("user");
  if (raw) {
    const user = JSON.parse(raw);
    localStorage.setItem(
      "user",
      JSON.stringify({
        ...user,
        username: normalized.username ?? user.username,
        tag: normalized.tag ?? user.tag,
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

  const url = data.file_key;
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
