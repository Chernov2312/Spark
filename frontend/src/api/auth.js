import { api, setToken, clearToken, getToken } from "./client";

/* Кастомное событие для Header */
const AUTH_CHANGE_EVENT = "spark:auth-change";

function emitAuthChange() {
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export const AUTH_EVENT = AUTH_CHANGE_EVENT;

/* POST /auth/register */
export async function registerUser({ username, email, password }) {
  const { data } = await api.post("/auth/register", {
    username,
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
  const url = `${import.meta.env.VITE_API_URL || "http://localhost:8080"}/api/v1/auth/verification/${token}`;

  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    redirect: "manual",
    headers: {
      Accept: "application/json",
    },
  });

  const authorization =
    response.headers.get("authorization") ||
    response.headers.get("Authorization");

  const accessToken =
    authorization && authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : null;

  if (!accessToken) {
    const text = await response.text();
    throw new Error(
      text || "Не удалось подтвердить почту. Попробуйте ещё раз.",
    );
  }

  setToken(accessToken);
  const payload = JSON.parse(
    atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
  );

  localStorage.setItem(
    "user",
    JSON.stringify({
      id: payload?.sub ?? null,
    }),
  );

  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));

  return { access_token: accessToken };
}
