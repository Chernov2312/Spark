import { api } from "./client";

/* Бэкенд отдаёт avatar_url как массив строк.
   Последний элемент = текущий аватар. */
function extractUrl(data) {
  if (!data) return null;

  const raw = data.avatar_url ?? data.url ?? null;
  if (!raw) return null;

  // Массив — берём последний
  if (Array.isArray(raw)) {
    return raw.length > 0 ? raw[raw.length - 1] : null;
  }

  return typeof raw === "string" ? raw : null;
}

export async function getMe() {
  const { data } = await api.get("/users/me");
  const url = extractUrl(data);
  return {
    ...data,
    avatar_url: url, // строка — для <img src>
    avatar_url_raw: url, // строка — для DELETE
  };
}

export async function updateMe(payload) {
  const { data } = await api.patch("/users/me", payload);
  const url = extractUrl(data);
  const normalized = {
    ...data,
    avatar_url: url,
    avatar_url_raw: url,
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
  const form = new FormData();
  form.append("avatar", file);
  const { data } = await api.post("/users/me/avatar", form);

  const url = extractUrl(data);
  return {
    avatar_url: url,
    avatar_url_raw: url,
  };
}

export async function deleteAvatar(url) {
  const { data } = await api.post("/users/me/delete/avatar", { url });
  return data;
}
