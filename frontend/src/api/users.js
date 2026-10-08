import { api } from "./client";

export async function getMe() {
  const { data } = await api.get("/users/me");
  return data;
}

export async function updateMe(payload) {
  const { data } = await api.patch("/users/me", payload);
  return data;
}

export async function uploadAvatar(file) {
  const form = new FormData();
  form.append("avatar", file);
  const { data } = await api.post("/users/me/avatar", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function deleteAvatar(url) {
  await api.post("/users/me/delete/avatar", { url });
}
