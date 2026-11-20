import { makeMessage } from "../src/test/fixtures";
import { test, expect, chatId, user } from "./support";

test("chat WebSocket connects to the page host with the access token", async ({ page, mockApi }) => {
  await mockApi.openChat();
  const expectedOrigin = new URL(page.url()).origin.replace(/^http/, "ws");
  await expect.poll(() => {
    const url = mockApi.socketUrl();
    return url ? new URL(url).origin : undefined;
  }).toBe(expectedOrigin);
  const url = new URL(mockApi.socketUrl()!);
  expect(url.pathname).toBe(`/${chatId}/ws`);
  expect(url.searchParams.get("token")).toBe(user.access_token);
});

test("chat recognizes contact links and displays a URL preview from WebSocket", async ({ page, mockApi }) => {
  const preview = { url: "https://example.com/article", title: "Заголовок статьи", description: "Краткое описание" };
  const message = makeMessage({
    id: "contact-links", chat_id: chatId,
    text: `Статья: ${preview.url}. Почта: spark@example.com. Телефон: +7 (999) 123-45-67.`,
  });
  mockApi.messages.set(chatId, [message]);
  await mockApi.openChat();
  const bubble = page.locator("#message-contact-links");
  await expect(bubble.getByRole("link", { name: preview.url, exact: true })).toHaveAttribute("href", preview.url);
  await expect(bubble.getByRole("link", { name: "spark@example.com" })).toHaveAttribute("href", "mailto:spark@example.com");
  await expect(bubble.getByRole("link", { name: "+7 (999) 123-45-67" })).toHaveAttribute("href", "tel:+79991234567");
  await mockApi.publish("message:link-preview", { chat_id: chatId, message_id: message.id, preview });
  await expect(bubble.getByRole("link", { name: /Заголовок статьи/ })).toHaveAttribute("href", preview.url);

  const text = "Две ссылки: (www.example.org). https://second.example.com/";
  await page.getByPlaceholder("Написать сообщение…").fill(text);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect.poll(() => mockApi.requests.find(
    (request) => request.method === "POST" && request.path === `/chats/${chatId}/messages`,
  )?.body).toMatchObject({ text, link_preview_url: "https://www.example.org" });
});

test("formats a selection from the mouse and keyboard and reveals spoilers on demand", async ({ page, mockApi }) => {
  await mockApi.openChat();
  const draft = page.locator(".chat-view__composer textarea");
  const toolbar = page.getByRole("group", { name: "Форматирование текста" });
  await draft.fill("Планы");
  await draft.press("Shift+Home");
  await expect(toolbar).toBeInViewport();
  await draft.press("Tab");
  const bold = toolbar.getByRole("button", { name: "Жирный" });
  await expect(bold).toBeFocused();
  await bold.press("Enter");
  await expect(draft).toHaveValue("**Планы**");
  await expect(draft).toBeFocused();
  await expect.poll(() => draft.evaluate((node: HTMLTextAreaElement) => node.value.slice(node.selectionStart, node.selectionEnd))).toBe("Планы");
  await draft.press("Control+i");
  await expect(draft).toHaveValue("***Планы***");

  const spoilerUrl = "https://example.org/hidden";
  const prefix = "***Планы*** ";
  await draft.fill(prefix + spoilerUrl);
  await draft.evaluate((node: HTMLTextAreaElement, start) => node.setSelectionRange(start, node.value.length), prefix.length);
  await toolbar.getByRole("button", { name: "Скрытый текст" }).click();
  await expect(draft).toHaveValue(`${prefix}||${spoilerUrl}||`);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();

  const sent = page.locator(".msg--me").filter({ hasText: "Планы" });
  const spoiler = sent.getByRole("button", { name: "Спойлер" });
  await expect(sent.locator("strong em")).toHaveText("Планы");
  await expect(spoiler).toHaveAttribute("aria-expanded", "false");
  await expect(sent.getByRole("link", { name: spoilerUrl })).toHaveCount(0);
  await expect(page.locator(".chat-item__preview").first()).toContainText("[Спойлер]");
  expect(mockApi.requests.find((request) => request.method === "POST" && request.path === `/chats/${chatId}/messages`)?.body)
    .toMatchObject({ text: `${prefix}||${spoilerUrl}||`, link_preview_url: null });

  await spoiler.click();
  await expect(sent.getByRole("link", { name: spoilerUrl })).toBeVisible();
  await sent.getByRole("button", { name: "Скрыть", exact: true }).press("Space");
  await expect(sent.getByRole("link", { name: spoilerUrl })).toHaveCount(0);
});

test.describe("touch message actions", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 }, colorScheme: "dark" });

  test("opens actions on hold and sends a reply after swiping a message", async ({ page, mockApi }) => {
    const author = { id: "participant-2", username: "Макс Чёрный", tag: "max", role: "member", avatar_urls: [] };
    await page.route(`**/api/v1/chats/${chatId}/members`, (route) =>
      route.fulfill({ json: [{ ...user, role: "owner", avatar_urls: [] }, author] }),
    );
    const incoming = makeMessage({
      id: "incoming",
      chat_id: chatId,
      user_id: author.id,
      text: "Сообщение другого участника",
    });
    const earlier = Array.from({ length: 20 }, (_, index) => makeMessage({
      id: `earlier-${index}`,
      chat_id: chatId,
      user_id: user.id,
      text: `Предыдущее сообщение ${index}`,
      created_at: "2026-01-01T11:00:00Z",
    }));
    mockApi.messages.set(chatId, [...earlier, incoming]);
    await mockApi.openChat();
    const message = page.locator("#message-incoming");
    const actions = page.getByRole("dialog", { name: "Действия с сообщением" });
    await expect(message.locator(".msg__author")).toBeVisible();
    await message.scrollIntoViewIfNeeded();
    const touch = await page.context().newCDPSession(page);
    const bounds = (await message.locator(".msg__text").boundingBox())!;
    const start = { x: Math.round(bounds.x + 12), y: Math.round(bounds.y + bounds.height / 2) };

    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
    await expect(actions).toBeVisible();
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(actions).toBeVisible();
    await expect(actions.getByRole("button", { name: "Изменить" })).toHaveCount(0);
    await expect(actions.getByRole("button", { name: "Удалить" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
    for (const offset of [20, 45, 80]) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...start, x: start.x + offset }],
      });
    }
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const preview = page.locator(".reply-preview");
    const form = page.locator(".chat-view__composer");
    const input = form.locator("textarea");
    const quote = preview.getByRole("button", { name: `В ответ ${author.username} ${incoming.text}` });
    await expect(quote).toBeVisible();
    const previewBounds = (await preview.boundingBox())!;
    const formBounds = (await form.boundingBox())!;
    expect(previewBounds.width).toBe(formBounds.width);
    expect(previewBounds.y + previewBounds.height).toBeLessThanOrEqual(formBounds.y);
    await page.locator(".chat-view__messages").evaluate((history) => { history.scrollTop = 0; });
    await expect(message).not.toBeInViewport();
    await quote.click();
    await expect(message).toBeInViewport();
    await input.fill("Отвечаю свайпом");
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    const sent = page.locator(".msg--me").filter({ hasText: "Отвечаю свайпом" });
    await expect(sent.getByRole("button", { name: `${author.username} ${incoming.text}` })).toBeVisible();
    expect(mockApi.requests.find((request) => request.method === "POST" && request.path === `/chats/${chatId}/messages`)?.body)
      .toMatchObject({ reply_to_id: incoming.id });
  });

  test("keeps the draft selection while a format button is tapped", async ({ page, mockApi }) => {
    await mockApi.openChat();
    const draft = page.locator(".chat-view__composer textarea");
    await draft.fill("форматирование");
    await draft.selectText();
    const strike = page.getByRole("button", { name: "Зачёркнутый" });
    await expect(strike).toBeInViewport();
    await strike.tap();
    await expect(draft).toHaveValue("~~форматирование~~");
    await expect(draft).toBeFocused();
    await draft.press("Escape");
    await expect(strike).toHaveCount(0);
  });
});

test("sent quotes fit the bubble and still show excerpts outside the loaded history", async ({ page, mockApi }) => {
  const original = makeMessage({ id: "original", user_id: user.id, text: "Длинная цитата ".repeat(40).trim() });
  const reply = makeMessage({ id: "incoming-reply", text: "Понял", user_id: "participant-2", reply_to_id: original.id });
  const oldReply = makeMessage({ id: "old-reply", text: "Спасибо", user_id: user.id, reply_to_id: "older", reply_to_text: "Текст из старой истории" });
  const interveningMessages = Array.from({ length: 20 }, (_, index) => makeMessage({
    id: `between-${index}`, user_id: user.id, text: `Сообщение ${index + 1}`,
  }));
  mockApi.messages.set(chatId, [original, ...interveningMessages, reply, oldReply]);
  await mockApi.openChat();

  const quote = page.locator("#message-incoming-reply").getByRole("button", { name: /^spark-e2e Длинная цитата/ });
  const excerpt = quote.locator(".msg__reply-text");
  await expect(quote).toBeVisible();
  await expect(quote).toHaveCSS("border-top-width", "0px");
  await expect(excerpt).toHaveCSS("text-overflow", "ellipsis");
  expect(await excerpt.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  const bubble = page.locator("#message-incoming-reply .msg__bubble");
  expect((await bubble.boundingBox())!.width - (await quote.boundingBox())!.width).toBeLessThanOrEqual(30);
  await expect(page.locator("#message-original")).not.toBeInViewport();
  await quote.click();
  await expect(page.locator("#message-original")).toBeInViewport();
  await expect(page.locator("#message-old-reply").getByRole("button", {
    name: "Исходное сообщение Текст из старой истории",
  })).toBeVisible();
});

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
  await expect(page.getByText("Участники", { exact: true })).toHaveCount(0);
  await expect(participant).toHaveCount(0);
  await page.getByRole("button", { name: "Открыть информацию о чате", exact: true }).click();
  await expect(participant).toContainText("Владелец");
  await participant.click();
  const profile = page.getByRole("dialog", { name: user.username });
  await expect(profile).toContainText(`@${user.tag}`);
  await expect(profile).toContainText("Владелец");
  await page.keyboard.press("Escape");
  await expect(profile).toBeHidden();
  await expect(participant).toBeFocused();

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

test("enables background notifications, synchronizes chat preferences and revokes the device on logout", async ({ page, mockApi }) => {
  const endpoint = "https://fcm.googleapis.com/fcm/send/test-device";
  await page.addInitScript((deviceEndpoint) => {
    Object.defineProperty(window, "Notification", {
      configurable: true, value: { permission: "granted" },
    });
    let subscribed = false;
    const subscription = {
      endpoint: deviceEndpoint,
      options: { applicationServerKey: new Uint8Array(65).fill(4).buffer },
      toJSON: () => ({ endpoint: deviceEndpoint, keys: { auth: "browser-auth", p256dh: "browser-key" } }),
      unsubscribe: async () => { subscribed = false; return true; },
    };
    const registration = {
      pushManager: {
        getSubscription: async () => subscribed ? subscription : null,
        subscribe: async () => { subscribed = true; return subscription; },
      },
      unregister: async () => true,
      getNotifications: async () => [],
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: async () => registration,
        getRegistration: async () => registration,
        ready: Promise.resolve(registration),
      },
    });
  }, endpoint);

  const requests: Array<{ method: string; body: unknown }> = [];
  await page.route("**/api/v1/push/config", (route) => route.fulfill({
    json: { public_key: Buffer.alloc(65, 4).toString("base64url") },
  }));
  await page.route("**/api/v1/push/subscription", async (route) => {
    const request = route.request();
    requests.push({ method: request.method(), body: request.postDataJSON() });
    await route.fulfill({ status: 204 });
  });

  await mockApi.openChat();
  await page.getByRole("button", { name: "Открыть информацию о чате" }).click();
  await page.getByRole("button", { name: "Настройки чата" }).click();
  await page.getByRole("button", { name: "Включить фоновые уведомления" }).click();
  await expect(page.getByRole("button", { name: "Отключить фоновые уведомления" })).toBeVisible();
  expect(requests[0]).toMatchObject({ method: "PUT", body: { endpoint, chat_options: {} } });
  await page.getByRole("switch", { name: "Звук", exact: true }).uncheck();
  await page.getByRole("switch", { name: "Без уведомлений" }).check();
  await expect.poll(() => requests.at(-1)).toMatchObject({
    method: "PUT", body: { chat_options: { [chatId]: { muted: true, silent: true } } },
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(requests.at(-1)).toEqual({ method: "DELETE", body: { endpoint } });
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
