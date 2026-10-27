import { api } from "./client";

/* POST /attachments/ — multipart/form-data, поле file */
export async function uploadAttachment(file) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/attachments/", form);
  return data;
}
