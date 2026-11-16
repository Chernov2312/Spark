import { api, setToken, clearToken, getToken } from "./client";

/* Кастомное событие для Header */
const AUTH_CHANGE_EVENT = "spark:auth-change";

function emitAuthChange() {
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export const AUTH_EVENT = AUTH_CHANGE_EVENT;

/* POST /auth/register */
export async function registerUser({ username, tag, email, password }) {
  const { data } = await api.post("/auth/register", {
    username,
    tag,
    email,
    password,
  });

  if (data.access_token) {
    setToken(data.access_token);
    localStorage.setItem(
      "user",
      JSON.stringify({
        id: data.id,
        username: data.username,
        tag: data.tag,
        email: data.email,
      }),
    );
    emitAuthChange();
  }
  return data;
}

/* POST /auth/login — form-urlencoded, поле формы называется username */
export async function loginUser({ username, password }) {
  const body = new URLSearchParams();
  body.append("username", username);
  body.append("password", password);

  const { data } = await api.post("/auth/login", body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  if (data.access_token) {
    setToken(data.access_token);
    localStorage.setItem(
      "user",
      JSON.stringify({
        id: data.id,
        username: data.username,
        tag: data.tag,
        email: data.email,
      }),
    );
    emitAuthChange();
  }
  return data;
}

export function logoutUser() {
  clearToken();
  emitAuthChange();
}

export function getCurrentUser() {
  const raw = localStorage.getItem("user");
  return raw ? JSON.parse(raw) : null;
}

export function isAuthenticated() {
  return Boolean(getToken());
}

/* GET /auth/verification/{token} */
export async function verifyEmailToken(token) {
  const { data } = await api.get(
    `/auth/verification/${encodeURIComponent(token)}`,
  );

  if (!data.access_token) {
    throw new Error("Ответ сервера не содержит access token");
  }

  setToken(data.access_token);
  localStorage.setItem(
    "user",
    JSON.stringify({
      id: data.id,
      username: data.username,
      tag: data.tag,
      email: data.email,
    }),
  );
  emitAuthChange();

  return data;
}
