import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, getToken, sessionApi, setToken } from "./client";

const apiAdapter = api.defaults.adapter;
const sessionAdapter = sessionApi.defaults.adapter;
const expired = `jwt.${btoa(JSON.stringify({ sub: "user", exp: 1 }))}.sig`;
const renewed = `jwt.${btoa(JSON.stringify({ sub: "user", exp: 9999999999 }))}.sig`;

function response(config: InternalAxiosRequestConfig, status: number, data: unknown = {}) {
  return { config, status, data, statusText: String(status), headers: {} };
}

function reject(config: InternalAxiosRequestConfig, status: number): never {
  throw new AxiosError("Request failed", undefined, config, undefined, response(config, status));
}

describe("access token refresh", () => {
  beforeEach(() => {
    localStorage.clear();
    setToken(expired);
    localStorage.setItem("user", JSON.stringify({ id: "user" }));
    window.history.replaceState(null, "", "/login");
  });

  afterEach(() => {
    api.defaults.adapter = apiAdapter;
    sessionApi.defaults.adapter = sessionAdapter;
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("shares one refresh and retries concurrent unauthorized requests", async () => {
    api.defaults.adapter = vi.fn(async (config) => {
      if (config.headers.get("Authorization") !== `Bearer ${renewed}`) reject(config, 401);
      return response(config, 200, config.url);
    });
    const refresh = vi.fn(async (config: InternalAxiosRequestConfig) => {
      expect(config.url).toBe("/auth/refresh");
      expect(config.withCredentials).toBe(true);
      return response(config, 200, { access_token: renewed });
    });
    sessionApi.defaults.adapter = refresh;

    const results = await Promise.all([api.get("/chats"), api.get("/users/me")]);

    expect(results.map(({ data }) => data)).toEqual(["/chats", "/users/me"]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(getToken()).toBe(renewed);
  });

  it("clears the local session when the refresh token is rejected", async () => {
    api.defaults.adapter = async (config) => reject(config, 401);
    sessionApi.defaults.adapter = async (config) => reject(config, 401);

    await expect(api.get("/chats")).rejects.toMatchObject({ status: 401 });
    expect(getToken()).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
  });

  it("retries a request only once and retains the session on temporary refresh failure", async () => {
    const request = vi.fn(async (config: InternalAxiosRequestConfig) => reject(config, 401));
    const refresh = vi.fn<AxiosAdapter>(async (config) => reject(config, 503));
    api.defaults.adapter = request;
    sessionApi.defaults.adapter = refresh;

    await expect(api.get("/chats")).rejects.toMatchObject({ status: 503 });
    expect(getToken()).toBe(expired);
    expect(request).toHaveBeenCalledOnce();
    refresh.mockImplementationOnce(async (config) => response(config, 200, { access_token: renewed }));
    await expect(api.get("/chats")).rejects.toMatchObject({ status: 401 });
    expect(request).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
