import { api } from "./client";

export const registerUser = async ({ email, password, name }) => {
  const { data } = await api.post("/auth/register", { email, password, name });
  return data;
};
