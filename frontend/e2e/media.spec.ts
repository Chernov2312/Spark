import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect, chatId, user } from "./support";

test("audio upload, explicit live transcription and authenticated download preserve the file", async ({ page, mockApi }) => {
  const bytes = readFileSync(resolve("..", "backend", "tests", "integration", "audio_converter", "audio.ogg"));
  await mockApi.openChat();
  await page.locator(".chat-view__composer input[type=file]").setInputFiles({ name: "voice-note.ogg", mimeType: "audio/ogg", buffer: bytes });
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const player = page.locator(".msg .audio-player");
  await expect(player).toBeVisible();
  await expect(player.locator("audio")).toBeAttached();
  await expect(player.getByRole("button", { name: "Скорость воспроизведения 1x" })).toBeVisible();
  expect(mockApi.uploads[0].body).toEqual(bytes);
  expect(mockApi.tempUrlRequests[0].file_content).toBe("audio/ogg");
  const message = mockApi.messages.get(chatId)![0];
  expect(message).toMatchObject({ text: null, attachments: [{ mime_type: "audio/ogg", file_name: "voice-note.ogg" }] });
  expect(mockApi.requests.filter((request) => request.path.endsWith("/transcribe"))).toHaveLength(0);

  await page.getByRole("button", { name: "Распознать", exact: true }).click();
  await expect(page.locator(".msg__attachment-text-content")).toHaveText("Распознавание…");
  await mockApi.finishTranscription(message, "Текст голосового сообщения");
  await expect(page.locator(".msg__attachment-text-content")).toHaveText("Текст голосового сообщения");
  expect(mockApi.requests.filter((request) => request.path.endsWith("/transcribe"))).toHaveLength(1);
  await page.reload();
  await expect(player).toBeVisible();
  await expect(page.locator(".msg__attachment-text-content")).toHaveText("Текст голосового сообщения");

  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать voice-note.ogg", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("voice-note.ogg");
  expect(readFileSync((await download.path())!)).toEqual(bytes);
  expect(mockApi.requests.find((request) => request.path.endsWith("/download"))?.authorization).toBe(`Bearer ${user.access_token}`);
  await expect(page).toHaveURL(new RegExp(`/chats/${chatId}$`));
});

test("the same photo is compressed and uploaded independently to two chats", async ({ page, mockApi }) => {
  const photo = readFileSync(resolve("..", "backend", "tests", "files", "testimage.jpg"));
  for (const chat of mockApi.chats) {
    await mockApi.openChat(chat.id);
    await page.locator(".chat-view__composer input[type=file]").setInputFiles({ name: "same-photo.jpg", mimeType: "image/jpeg", buffer: photo });
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.locator(".msg__media-grid img")).toBeVisible();
  }
  expect(mockApi.tempUrlRequests.map((request) => request.file_extension)).toEqual(["webp", "webp"]);
  expect(mockApi.uploads).toHaveLength(2);
  expect(mockApi.uploads.every((upload) => upload.contentType === "image/webp" && upload.body.length > 0)).toBe(true);
  expect(new Set(mockApi.uploads.map((upload) => upload.key)).size).toBe(2);
  for (const chat of mockApi.chats) expect(mockApi.messages.get(chat.id)).toHaveLength(1);
});
