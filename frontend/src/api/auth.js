import { api, setToken, clearToken, getToken } from "./client";

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
  }
  return data;
}

/* POST /auth/login — URL-encoded */
export async function loginUser({ email, password }) {
  const body = new URLSearchParams();
  body.append("email", email);
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
  }
  return data;
}

export function logoutUser() {
  clearToken();
}

export function getCurrentUser() {
  const raw = localStorage.getItem("user");
  return raw ? JSON.parse(raw) : null;
}

export function isAuthenticated() {
  return Boolean(getToken());
}
