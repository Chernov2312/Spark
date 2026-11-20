import axios from "axios";

const configuredApiUrl =
  import.meta.env.VITE_API_URL || "http://localhost:8001";
const normalizedApiUrl = configuredApiUrl.replace(/\/+$/, "");

export const API_BASE = normalizedApiUrl.endsWith("/api/v1")
  ? normalizedApiUrl
  : `${normalizedApiUrl}/api/v1`;

export const api = axios.create({
  baseURL: API_BASE,
});

export const sessionApi = axios.create({ baseURL: API_BASE, withCredentials: true });

export const setToken = (t) => localStorage.setItem("access_token", t);
export const getToken = () => localStorage.getItem("access_token");
export const clearToken = () => {
  localStorage.removeItem("access_token");
  localStorage.removeItem("user");
};

let sessionQueue = Promise.resolve();
let pendingRefresh;

export function withSessionLock(action) {
  if (navigator.locks) return navigator.locks.request("spark:session", action);
  const result = sessionQueue.then(action);
  sessionQueue = result.catch(() => {});
  return result;
}

function tokenClaims(token) {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

function latestTokenFor(previousToken) {
  const token = getToken();
  if (!token || token === previousToken) return token;
  const previousUser = tokenClaims(previousToken)?.sub;
  return previousUser && tokenClaims(token)?.sub === previousUser ? token : null;
}

function expireSession() {
  clearToken();
  if (window.location.pathname !== "/login") window.location.href = "/login";
  return null;
}

export function refreshAccessToken(previousToken) {
  if (pendingRefresh?.token === previousToken) return pendingRefresh.promise;
  const promise = withSessionLock(async () => {
    const current = latestTokenFor(previousToken);
    if (current !== previousToken) return current;
    try {
      const { data } = await sessionApi.post("/auth/refresh");
      if (getToken() !== current) return latestTokenFor(current);
      const user = tokenClaims(current)?.sub;
      if (!data.access_token || (user && tokenClaims(data.access_token)?.sub !== user)) {
        return expireSession();
      }
      setToken(data.access_token);
      return data.access_token;
    } catch (error) {
      if (error.response?.status !== 401) throw error;
      if (getToken() !== current) return latestTokenFor(current);
      return expireSession();
    }
  }).finally(() => {
    if (pendingRefresh?.promise === promise) pendingRefresh = undefined;
  });
  pendingRefresh = { token: previousToken, promise };
  return promise;
}

export function getValidAccessToken() {
  const token = getToken();
  const expiresAt = tokenClaims(token)?.exp;
  if (expiresAt && expiresAt * 1000 <= Date.now() + 5000) return refreshAccessToken(token);
  return token;
}

api.interceptors.request.use((config) => {
  const token = config.refreshedToken ? latestTokenFor(config.refreshedToken) : getToken();
  if (config.refreshedToken && !token) throw new axios.CanceledError("Session changed");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const authorization = config?.headers?.get("Authorization");
    if (error.response?.status !== 401 || !authorization?.startsWith("Bearer ") ||
        config.refreshedToken || config.url?.startsWith("/auth/")) {
      throw error;
    }
    const token = await refreshAccessToken(authorization.slice(7));
    if (!token) throw error;
    config.refreshedToken = token;
    return api.request(config);
  },
);
