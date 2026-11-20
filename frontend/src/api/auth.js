import { api, sessionApi, setToken, clearToken, getToken, withSessionLock } from "./client";
import { disableWebPush, isWebPushEnabled } from "./push";

export const AUTH_EVENT = "spark:auth-change";

function emitAuthChange() {
  window.dispatchEvent(new Event(AUTH_EVENT));
}

function storeSession(data) {
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

export async function registerUser({ username, tag, email, password }) {
  const { data } = await api.post("/auth/register", {
    username,
    tag,
    email,
    password,
  });
  if (data.access_token) storeSession(data);
  return data;
}

/* POST /auth/login — form-urlencoded, поле формы называется username */
export async function loginUser({ username, password }) {
  const body = new URLSearchParams();
  body.append("username", username);
  body.append("password", password);

  return withSessionLock(async () => {
    const { data } = await sessionApi.post("/auth/login", body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (data.access_token) storeSession(data);
    return data;
  });
}

export async function logoutUser() {
  const userId = getCurrentUser()?.id;
  if (isWebPushEnabled(userId)) await disableWebPush(userId).catch(() => {});
  await withSessionLock(async () => {
    try {
      await sessionApi.post("/auth/logout");
    } finally {
      clearToken();
      emitAuthChange();
    }
  }).catch(() => {});
}

export function getCurrentUser() {
  const raw = localStorage.getItem("user");
  return raw ? JSON.parse(raw) : null;
}

export function isAuthenticated() {
  return Boolean(getToken());
}

export async function verifyEmailToken(token) {
  return withSessionLock(async () => {
    const { data } = await sessionApi.get(`/auth/verification/${encodeURIComponent(token)}`);
    if (!data.access_token) {
      throw new Error("Ответ сервера не содержит access token");
    }
    storeSession(data);
    return data;
  });
}

export async function requestPasswordReset(email) {
  const { data } = await api.post("/auth/password/forgot", { email });
  return data;
}

export async function resetPassword(token, password) {
  const { data } = await api.post("/auth/password/reset", { token, password });
  return data;
}
