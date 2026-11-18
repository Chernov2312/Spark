import { makeMessage } from "../src/test/fixtures";
import { test, expect, chatId, user } from "./support";

test("history scrolls inside the viewport, preserves the reading position and supports search", async ({ page, mockApi }) => {
  mockApi.messages.set(chatId, Array.from({ length: 50 }, (_, index) => makeMessage({ id: `history-${index}`, chat_id: chatId, user_id: user.id, text: `Message ${index}` })));
  await mockApi.openChat();
  const history = page.locator(".chat-view__messages");
  await expect(page.locator(".msg")).toHaveCount(50);
  expect(await history.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
  await history.evaluate((node) => { node.scrollTop = 0; });
  await page.locator(".chat-view__composer textarea").fill("Draft while reading history");
  expect(await history.evaluate((node) => node.scrollTop)).toBe(0);

  await page.getByRole("button", { name: "Открыть поиск", exact: true }).click();
  await page.getByRole("textbox", { name: "Поиск по сообщениям" }).fill("Message 49");
  await expect(page.getByLabel("Тип вложения", { exact: true })).toBeHidden();
  await page.locator(".message-search__filters summary").click();
  await expect(page.getByLabel("Тип вложения", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.locator(".msg")).toHaveCount(1);
  await expect(page.locator(".msg")).toContainText("Message 49");
  await page.getByRole("button", { name: "Скрыть поиск" }).click();
  await expect(page.locator(".msg")).toHaveCount(50);
});

test("participant profile and dropdown settings work with keyboard and persist preferences", async ({ page, mockApi }) => {
  await mockApi.openChat();
  const participant = page.getByRole("button", { name: `Открыть профиль ${user.username}`, exact: true });
  await expect(participant).toContainText("Владелец");
  await participant.click();
  const profile = page.getByRole("dialog", { name: user.username });
  await expect(profile).toContainText(`@${user.tag}`);
  await expect(profile).toContainText("Владелец");
  await page.keyboard.press("Escape");
  await expect(profile).toBeHidden();
  await expect(participant).toBeFocused();

  await page.getByRole("button", { name: "Открыть информацию о чате", exact: true }).click();
  const trigger = page.getByRole("button", { name: "Настройки чата", exact: true });
  await expect(page.getByRole("dialog", { name: "Настройки чата" })).toHaveCount(0);
  await trigger.click();
  const settings = page.getByRole("dialog", { name: "Настройки чата" });
  await settings.getByRole("switch", { name: "Звук", exact: true }).uncheck();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.reload();
  await page.getByRole("button", { name: "Открыть информацию о чате", exact: true }).click();
  await trigger.click();
  await expect(settings.getByRole("switch", { name: "Звук", exact: true })).not.toBeChecked();
});

test("pins outside the loaded history display and react to live updates and removal", async ({ page, mockApi }) => {
  const pinned = makeMessage({ id: "old-pin", chat_id: chatId, user_id: user.id, text: "Старое важное сообщение", is_pinned: true });
  mockApi.messages.set(chatId, [makeMessage({ chat_id: chatId, text: "Текущая история" })]);
  mockApi.pins.set(chatId, [pinned]);
  await mockApi.openChat();
  const pins = page.getByRole("region", { name: "Закреплённые сообщения" });
  await expect(pins).toContainText(pinned.text!);
  await expect(page.locator(".msg")).toHaveCount(1);
  await mockApi.publish("message:updated", { ...pinned, text: "Обновлённый закреп" });
  await expect(pins).toContainText("Обновлённый закреп");
  mockApi.pins.set(chatId, []);
  await mockApi.publish("message:deleted", { chat_id: chatId, message_id: pinned.id });
  await expect(pins).toBeHidden();
});

test("shared avatar gallery supports keyboard navigation and keeps personal photos separate", async ({ page, mockApi }) => {
  const photo = (color: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${color}"/></svg>`)}`;
  const first = photo("red");
  const second = photo("blue");
  const personal = photo("green");
  mockApi.chats[0].avatar_urls = [first, second];
  mockApi.chats[0].personal_avatar_url = personal;
  await mockApi.openChat();
  await page.getByRole("button", { name: "Открыть информацию о чате", exact: true }).click();
  const gallery = page.getByRole("region", { name: "Аватарки группы", exact: true });
  await expect(gallery.getByRole("button", { name: /Открыть аватарку группы/ })).toHaveCount(2);
  expect(await gallery.locator("img").evaluateAll((images) => images.map((image) => image.getAttribute("src")))).not.toContain(personal);
  const trigger = gallery.getByRole("button", { name: "Открыть аватарку группы 2", exact: true });
  await trigger.click();
  const viewer = page.getByRole("dialog", { name: "Просмотр аватарок группы" });
  await expect(viewer.getByRole("img")).toHaveAttribute("src", first);
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByRole("img")).toHaveAttribute("src", second);
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByRole("img")).toHaveAttribute("src", first);
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(trigger).toBeFocused();
});
