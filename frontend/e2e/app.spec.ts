import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const user = {
  id: "c4e833e0-0cf3-4b83-a1e5-56b8874e3e93",
  username: "spark-e2e",
  email: "spark-e2e@example.com",
  access_token: "playwright-test-token",
  token_type: "bearer",
};

const chatFixtures = [
  {
    id: "6b833462-969f-4a48-bdfc-4147f83be3a8",
    title: "Audio test chat",
    description: "",
    owner_id: user.id,
    avatar_urls: [],
    created_at: "2026-01-01T12:00:00Z",
  },
  {
    id: "77ad93de-3ea3-4dbe-b102-52ab42bf77aa",
    title: "Second test chat",
    description: "",
    owner_id: user.id,
    avatar_urls: [],
    created_at: "2026-01-01T12:00:00Z",
  },
];

async function openAuthenticatedChat(page: Page, chatId: string) {
  await page.addInitScript(({ token, currentUser }) => {
    localStorage.setItem("access_token", token);
    localStorage.setItem("user", JSON.stringify(currentUser));
  }, { token: user.access_token, currentUser: user });
  await page.goto(`/chats/${chatId}`);
  await expect(page.locator(".chat-view__title")).toBeVisible();
}

async function mockSocialApi(page: Page) {
  await page.route("**/api/v1/friends", async (route) => {
    await route.fulfill({
      status: 200,
      json: { friends: [], requests: [], categories: [] },
    });
  });
  await page.route("**/api/v1/chat-folders", async (route) => {
    await route.fulfill({ status: 200, json: { folders: [] } });
  });
}

test("chat history scrolls inside the viewport", async ({ page }, testInfo) => {
  await mockSocialApi(page);
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => socket.close());
  await page.route("**/api/v1/chats", (route) => route.fulfill({ json: { chats: chatFixtures } }));
  await page.route("**/api/v1/chats/*/threads", (route) => route.fulfill({ json: { messages: [] } }));
  await page.route("**/api/v1/chats/*/members", (route) => route.fulfill({ json: [] }));
  await page.route(/\/api\/v1\/chats\/[^/]+\/messages(?:\?.*)?$/, (route) => route.fulfill({ json: {
    messages: Array.from({ length: 50 }, (_, index) => ({
      id: `scroll-message-${index}`, chat_id: chatFixtures[0].id, user_id: user.id,
      text: `Message ${index}`, attachments: [], created_at: "2026-01-01T12:00:00Z",
    })),
  } }));
  await openAuthenticatedChat(page, chatFixtures[0].id);
  const history = page.locator(".chat-view__messages");
  await expect(page.locator(".msg")).toHaveCount(50);
  expect(await history.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
  await history.evaluate((node) => { node.scrollTop = 0; });
  await page.locator(".chat-view__composer textarea").fill("Draft while reading history");
  expect(await history.evaluate((node) => node.scrollTop)).toBe(0);
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Профиль чата", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Открыть информацию о чате", exact: true }).click();
  await expect(page.getByRole("region", { name: "Информация о чате" })).toBeVisible();
  await expect(page.getByLabel("Моя картинка чата", { exact: true })).toBeAttached();
  await page.getByRole("button", { name: "← Вернуться к сообщениям" }).click();
  await page.getByRole("button", { name: "Открыть поиск", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Поиск по сообщениям" })).toBeVisible();
  await expect(page.getByLabel("Тип вложения", { exact: true })).toBeHidden();
  await page.locator(".message-search__filters summary").click();
  await expect(page.getByLabel("Тип вложения", { exact: true })).toBeVisible();
  const bounds = await page.locator(".message-search__filter-fields").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: testInfo.outputPath("chat-search.png") });
});

async function mockChatMediaApi(page: Page) {
  let uploadNumber = 0;
  let attachmentNumber = 0;
  const tempUrlRequests: Array<Record<string, string>> = [];
  const uploads: Array<{
    key: string;
    body: Buffer;
    contentType: string;
  }> = [];
  const savedMessages = new Map<string, Array<Record<string, unknown>>>();
  const storedMedia = new Map<string, { body: Buffer; contentType: string }>();

  await mockSocialApi(page);
  await page.routeWebSocket(/\/ws(?:\?|$)/, (socket) => socket.close());
  await page.route("**/api/v1/chats", async (route) => {
    await route.fulfill({ status: 200, json: { chats: chatFixtures } });
  });
  await page.route("**/api/v1/chats/*/messages*", async (route) => {
    const url = new URL(route.request().url());
    const chatId = url.pathname.split("/")[4];
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        json: { messages: savedMessages.get(chatId) || [] },
      });
      return;
    }

    const request = route.request().postDataJSON() as {
      text: string | null;
      attachments: Array<Record<string, unknown>>;
    };
    const attachments = request.attachments.map((attachment) => {
      const id = String(attachment.id);
      const uploaded = uploads.find((upload) => upload.key === attachment.file_key);
      if (uploaded) storedMedia.set(id, uploaded);
      return { ...attachment, file_key: `/__media/${id}` };
    });
    const message = {
      id: `message-${(savedMessages.get(chatId)?.length || 0) + 1}`,
      chat_id: chatId,
      user_id: user.id,
      text: request.text,
      attachments,
      reactions_count: {},
      created_at: new Date().toISOString(),
    };
    savedMessages.set(chatId, [...(savedMessages.get(chatId) || []), message]);
    await route.fulfill({ status: 201, json: message });
  });
  await page.route("**/api/v1/attachments/temporary-url", async (route) => {
    uploadNumber += 1;
    const request = route.request().postDataJSON() as Record<string, string>;
    tempUrlRequests.push(request);
    const key = `user_message/${user.id}/upload-${uploadNumber}.${request.file_extension}`;
    await route.fulfill({
      status: 200,
      json: {
        user_id: user.id,
        file_key: key,
        temporary_url: `/__upload/${uploadNumber}`,
      },
    });
  });
  await page.route("**/__upload/*", async (route) => {
    const body = route.request().postDataBuffer() || Buffer.alloc(0);
    const key = `user_message/${user.id}/upload-${uploads.length + 1}.${tempUrlRequests[uploads.length].file_extension}`;
    uploads.push({
      key,
      body,
      contentType: route.request().headers()["content-type"] || "",
    });
    await route.fulfill({ status: 200, body: "" });
  });
  await page.route("**/api/v1/attachments/", async (route) => {
    attachmentNumber += 1;
    const request = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      json: { ...request, id: `attachment-${attachmentNumber}`, text: null },
    });
  });
  await page.route("**/__media/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() || "";
    const media = storedMedia.get(id);
    await route.fulfill({
      status: media ? 200 : 404,
      contentType: media?.contentType || "application/octet-stream",
      body: media?.body || Buffer.alloc(0),
    });
  });

  return { tempUrlRequests, uploads, savedMessages };
}

test("home page registration action opens the registration form", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator("#home-title")).toBeVisible();
  await page.locator(".home__actions .home__btn--primary").click();

  await expect(page).toHaveURL(/\/register$/);
  await expect(page.locator("form.register-card")).toBeVisible();
});

test("unauthenticated users are redirected from chats to login", async ({
  page,
}) => {
  await page.goto("/chats");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("form.register-card")).toBeVisible();
});

test("registration validation blocks incomplete data before calling the API", async ({
  page,
}) => {
  let registrationRequests = 0;
  await page.route("**/api/v1/auth/register", async (route) => {
    registrationRequests += 1;
    await route.fulfill({ status: 201, json: user });
  });

  await page.goto("/register");
  await page.locator('input[autocomplete="username"]').fill("ab");
  await page
    .locator('form.register-card button[type="submit"]')
    .click();

  await expect(page.locator(".register-card__error")).toBeVisible();
  expect(registrationRequests).toBe(0);
});

test("login opens the chat list and logout returns to login", async ({
  page,
}) => {
  await mockSocialApi(page);
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({ status: 200, json: user });
  });
  await page.route("**/api/v1/chats", async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        chats: [
          {
            id: "6b833462-969f-4a48-bdfc-4147f83be3a8",
            title: "Playwright chat",
            description: "Browser test chat",
            owner_id: user.id,
            avatar_urls: [],
            created_at: "2026-01-01T12:00:00Z",
          },
        ],
      },
    });
  });

  await page.goto("/login");
  await page.locator('input[autocomplete="username"]').fill(user.username);
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("ValidPassword123");
  await page.locator('form.register-card button[type="submit"]').click();

  await expect(page).toHaveURL(/\/chats$/);
  await expect(page.locator(".header-user")).toHaveText(`@${user.username}`);
  await expect(page.locator(".chat-item__title")).toHaveText(
    "Playwright chat",
  );
  await expect(page).toHaveURL(/\/chats$/);

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("audio uploads and remains visible in chat history without a caption", async ({
  page,
}) => {
  const mediaApi = await mockChatMediaApi(page);
  await openAuthenticatedChat(page, chatFixtures[0].id);

  const audioBytes = Buffer.from("playwright audio payload");
  await page.locator(".chat-view__composer input[type=file]").setInputFiles({
    name: "voice-note.webm",
    mimeType: "audio/webm",
    buffer: audioBytes,
  });
  await expect(page.locator(".composer-btn--send")).toBeEnabled();
  await page.locator(".composer-btn--send").click();

  await expect(page.locator(".msg .audio-player audio")).toBeVisible();
  expect(mediaApi.uploads).toHaveLength(1);
  expect(mediaApi.uploads[0].body).toEqual(audioBytes);
  expect(mediaApi.tempUrlRequests[0].file_content).toBe("audio/webm");
  expect(mediaApi.savedMessages.get(chatFixtures[0].id)?.[0]).toMatchObject({
    text: null,
    attachments: [{ mime_type: "audio/webm", file_name: "voice-note.webm" }],
  });

  await page.reload();
  await expect(page.locator(".chat-view__title")).toBeVisible();
  await expect(page.locator(".msg .audio-player audio")).toBeVisible();
  await expect(page.locator(".msg__attachment-text-title")).toHaveText(
    "Распознанный текст",
  );
});

test("compressed copy of the same photo uploads to two chats independently", async ({
  page,
}) => {
  const mediaApi = await mockChatMediaApi(page);
  const photo = readFileSync(resolve("..", "backend", "tests", "files", "testimage.jpg"));

  for (const chat of chatFixtures) {
    await openAuthenticatedChat(page, chat.id);
    await page.locator(".chat-view__composer input[type=file]").setInputFiles({
      name: "same-photo.jpg",
      mimeType: "image/jpeg",
      buffer: photo,
    });
    await page.locator(".composer-btn--send").click();
    await expect(page.locator(".msg__media-grid img")).toBeVisible();
  }

  expect(mediaApi.tempUrlRequests).toHaveLength(2);
  expect(mediaApi.tempUrlRequests.map((request) => request.file_extension)).toEqual([
    "webp",
    "webp",
  ]);
  expect(mediaApi.uploads).toHaveLength(2);
  expect(mediaApi.uploads.every((upload) => upload.contentType === "image/webp")).toBe(
    true,
  );
  expect(mediaApi.uploads.every((upload) => upload.body.length > 0)).toBe(true);
  expect(new Set(mediaApi.uploads.map((upload) => upload.key)).size).toBe(2);
  expect(mediaApi.savedMessages.get(chatFixtures[0].id)).toHaveLength(1);
  expect(mediaApi.savedMessages.get(chatFixtures[1].id)).toHaveLength(1);
});
