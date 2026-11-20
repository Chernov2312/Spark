import { type Page } from "@playwright/test";
import { test, expect, chatId, user } from "./support";

const callId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function mockMedia(page: Page) {
  return page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true, value: { getUserMedia: async () => new MediaStream() },
    });
  });
}

test("starts a call through WebSocket and manages its invite through the Go REST API", async ({ page, mockApi }) => {
  await mockMedia(page);
  let sentAuth;
  let started;
  await page.routeWebSocket("**/v1/calls/ws", (ws) => {
    ws.onMessage((raw) => {
      const { event, data } = JSON.parse(raw.toString());
      if (event === "auth") {
        sentAuth = data;
        ws.send(JSON.stringify({ event: "auth:ok", data: { user_id: user.id, ice_servers: [] } }));
      }
      if (event === "call:start") {
        started = data;
        ws.send(JSON.stringify({ event: "call:started", data: { call_id: callId, ...data, ice_servers: [] } }));
      }
    });
  });
  const inviteUrl = "https://spark.example/call/join#invite=test";
  let inviteAuthorization;
  let revoked = false;
  await page.route(`**/v1/calls/${callId}/invites`, (route) => {
    inviteAuthorization = route.request().headers().authorization;
    return route.fulfill({ status: 201, json: { invite_id: "invite-id", invite_url: inviteUrl } });
  });
  await page.route("**/v1/calls/invites/invite-id", (route) => {
    revoked = route.request().method() === "DELETE";
    return route.fulfill({ status: 204 });
  });

  await mockApi.openChat();
  await page.getByRole("button", { name: "Начать звонок" }).click();
  await page.getByRole("button", { name: "Видеозвонок" }).click();
  expect(sentAuth).toEqual({ access_token: user.access_token });
  await page.getByRole("button", { name: "Создать гостевую ссылку" }).click();
  expect(started).toEqual({ chat_id: chatId, media: "video" });
  await expect(page.getByRole("textbox", { name: "Гостевая ссылка" })).toHaveValue(inviteUrl);
  expect(inviteAuthorization).toBe("Bearer " + user.access_token);
  await page.getByRole("button", { name: "Отозвать ссылку" }).click();
  await expect(page.getByRole("textbox", { name: "Гостевая ссылка" })).toHaveCount(0);
  expect(revoked).toBe(true);
});

test("a guest joins without a Spark account and the invite fragment is cleared", async ({ page }) => {
  await mockMedia(page);
  let sentAuth;
  let accepted;
  await page.routeWebSocket("**/v1/calls/ws", (ws) => {
    ws.onMessage((raw) => {
      const { event, data } = JSON.parse(raw.toString());
      if (event === "auth") {
        sentAuth = data;
        ws.send(JSON.stringify({ event: "auth:ok", data: { guest: true, call_id: callId, ice_servers: [] } }));
        ws.send(JSON.stringify({ event: "call:incoming", data: { call_id: callId, caller_name: "Владелец", media: "audio" } }));
      }
      if (event === "call:accept") {
        accepted = data;
        ws.send(JSON.stringify({ event: "call:accepted", data: { call_id: callId, ice_servers: [] } }));
      }
    });
  });
  await page.goto("/call/join#invite=test");
  await expect(page).toHaveURL(/\/call\/join$/);
  await page.getByRole("button", { name: "Принять звонок" }).click();
  expect(sentAuth).toEqual({ invite_token: "test" });
  await expect(page.getByRole("button", { name: "Завершить звонок" })).toBeEnabled();
  expect(accepted).toEqual({ call_id: callId });
  await page.getByRole("button", { name: "Завершить звонок" }).click();
  await expect(page.getByText("Вы покинули звонок.")).toBeVisible();
});
