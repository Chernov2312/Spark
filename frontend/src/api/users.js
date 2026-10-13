import { api } from "./client";

/* GET /users/me → { id, username, email, avatar_url, created_at } */
export async function getMe() {
  const { data } = await api.get("/users/me");
  return data;
}

/* PATCH /users/me — { username?, email? } → обновлённый профиль */
export async function updateMe(payload) {
  const { data } = await api.patch("/users/me", payload);

  // Синхронизируем кэш в localStorage, чтобы Header сразу показал новое имя
  const raw = localStorage.getItem("user");
  if (raw) {
    const user = JSON.parse(raw);
    localStorage.setItem(
      "user",
      JSON.stringify({
        ...user,
        username: data.username ?? user.username,
        email: data.email ?? user.email,
      }),
    );
    window.dispatchEvent(new Event("spark:auth-change"));
  }

  return data;
}

/* POST /users/me/avatar — multipart/form-data, поле "avatar"
   → { avatar_url } */
export async function uploadAvatar(file) {
  const form = new FormData();
  form.append("avatar", file);
  const { data } = await api.post("/users/me/avatar", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

/* POST /users/me/delete/avatar — { url } → 204 No Content */
export async function deleteAvatar(url) {
  await api.post("/users/me/delete/avatar", { url });
}
