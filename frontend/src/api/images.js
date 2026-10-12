import { api } from "./client";

/* POST /images/upload — multipart, поле image, опционально chat_id */
export async function uploadImage(file, chatId) {
  const form = new FormData();
  form.append("image", file);
  const params = chatId ? { chat_id: chatId } : undefined;
  const { data } = await api.post("/images/upload", form, {
    params,
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data; // { id, image_url, user_id, chat_id }
}
