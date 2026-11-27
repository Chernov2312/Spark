import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { apiMocks, audioMessage, chat, renderChat, socialMocks, socketState, setupChatTests } from "../test/chatHarness";
import { deferred, testUser } from "../test/fixtures";

setupChatTests();

function findMessage(id = audioMessage.id) {
  return waitFor(() => {
    const message = document.getElementById(`message-${id}`);
    expect(message).toBeInTheDocument();
    return message!;
  });
}

describe("ChatsPage: messages", () => {
  it("shows forwarding labels and captions in history and in live messages", async () => {
    apiMocks.listMessages.mockResolvedValue([{
      ...audioMessage, is_forwarded: true, forward_caption: "Подпись из истории",
    }]);
    renderChat();
    const saved = within(await findMessage());
    expect(saved.getByText("Пересланное сообщение")).toBeVisible();
    expect(saved.getByText("Подпись из истории")).toBeVisible();
    act(() => socketState.options!.onEvent("message:new", {
      ...audioMessage, id: "forward", text: "Копия", attachments: [], is_forwarded: true,
      forward_caption: "Подпись из события",
    }));
    const live = within(await findMessage("forward"));
    expect(live.getByText("Пересланное сообщение")).toBeVisible();
    expect(live.getByText("Подпись из события")).toBeVisible();
  });

  it.each([
    [null, "🔥", 1, 2],
    ["🔥", null, 2, 1],
  ] as const)("keeps a reaction change from %s to %s when WebSocket arrives before REST", async (before, after, oldCount, newCount) => {
    const result = deferred<{ updated_reactions_count: Record<string, number>; user_reaction: string | null }>();
    apiMocks.listMessages.mockResolvedValue([{
      ...audioMessage, reactions_count: { "🔥": oldCount }, user_reaction: before,
    }]);
    apiMocks.addReaction.mockReturnValue(result.promise);
    renderChat();
    const message = within(await findMessage());
    fireEvent.click(message.getByRole("button", { name: `🔥 ${oldCount}` }));
    expect(apiMocks.addReaction).toHaveBeenCalledWith(audioMessage.id, "🔥");

    const counters = { "🔥": newCount };
    act(() => socketState.options!.onEvent("message:reactions", {
      chat_id: chat.id, message_id: audioMessage.id, user_id: testUser.id,
      user_reaction: after, reactions_count: counters,
    }));
    expect(message.getByRole("button", { name: `🔥 ${newCount}` })).toHaveAttribute("aria-pressed", String(Boolean(after)));

    await act(async () => result.resolve({ updated_reactions_count: counters, user_reaction: after }));
    expect(message.getByRole("button", { name: `🔥 ${newCount}` })).toHaveAttribute("aria-pressed", String(Boolean(after)));
  });

  it.each([
    ["stranger", chat.owner_id, [], true],
    ["friend", chat.owner_id, [{ id: chat.owner_id }], false],
    ["self", "user-1", [], false],
  ] as const)("checks the creator notice for %s after friends load", async (_, ownerId, friends, visible) => {
    const result = deferred<{ friends: typeof friends; requests: []; sentRequests: []; categories: [] }>();
    socialMocks.listFriends.mockReturnValue(result.promise);
    apiMocks.listChats.mockResolvedValue([{ ...chat, owner_id: ownerId }]);
    renderChat();
    await findMessage();
    const notice = "Этот чат создал пользователь, которого нет в ваших контактах.";
    expect(screen.queryByText(notice)).toBeNull();
    await act(async () => result.resolve({ friends, requests: [], sentRequests: [], categories: [] }));
    expect(Boolean(screen.queryByText(notice))).toBe(visible);
  });

  it("removes the creator notice when their friend request is accepted", async () => {
    const creator = { id: chat.owner_id, username: "Алексей", tag: "alex" };
    const lists = { friends: [], requests: [], sentRequests: [], categories: [] };
    socialMocks.listFriends.mockResolvedValueOnce({ ...lists, requests: [creator] })
      .mockResolvedValue({ ...lists, friends: [creator] });
    socialMocks.acceptFriend.mockResolvedValue({});
    renderChat();
    const notice = await screen.findByText("Этот чат создал пользователь, которого нет в ваших контактах.");
    fireEvent.click(screen.getByRole("tab", { name: /Контакты/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Принять" }));
    await waitFor(() => expect(notice).not.toBeInTheDocument());
    expect(socialMocks.acceptFriend).toHaveBeenCalledWith(creator.id);
  });

  it("sends a read receipt only for the active chat's latest message", async () => {
    const otherChat = { ...chat, id: "chat-2", title: "Второй чат" };
    const otherMessage = { ...audioMessage, id: "other-message", chat_id: otherChat.id };
    const otherHistory = deferred<(typeof audioMessage)[]>();
    apiMocks.listChats.mockResolvedValue([chat, otherChat]);
    apiMocks.listMessages.mockImplementation((id) =>
      id === chat.id ? Promise.resolve([audioMessage]) : otherHistory.promise,
    );
    renderChat();
    await waitFor(() => expect(apiMocks.markChatRead).toHaveBeenCalledWith(chat.id, audioMessage.id));

    act(() => socketState.options!.onEvent("message:updated", { ...audioMessage, text: "Изменено" }));
    expect(apiMocks.markChatRead).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByText(otherChat.title, { selector: ".chat-item__title" }));
    expect(apiMocks.markChatRead).toHaveBeenCalledTimes(1);
    await act(async () => otherHistory.resolve([otherMessage]));
    expect(apiMocks.markChatRead.mock.calls).toEqual([
      [chat.id, audioMessage.id],
      [otherChat.id, otherMessage.id],
    ]);
  });

  it("links website URLs, phone numbers and email addresses while preserving Markdown and code", async () => {
    apiMocks.listMessages.mockResolvedValue([{
      ...audioMessage,
      attachments: [],
      text: 'Сайт: (**https://example.com/?a=1&b=2**). [Документация](https://docs.example.com/) '
        + 'www.example.org, почта user+chat@example.com, телефон 8 (800) 555-35-35. '
        + '\x60https://code.example.com\x60 [ошибка](javascript:alert(1)) <img src=x>',
    }]);
    renderChat();
    const message = await findMessage();
    const controls = within(message);
    const link = controls.getByRole("link", { name: "https://example.com/?a=1&b=2" });
    expect(link).toHaveAttribute("href", "https://example.com/?a=1&b=2");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.closest("strong")).not.toBeNull();
    expect(controls.getByRole("link", { name: "Документация" })).toHaveAttribute("href", "https://docs.example.com/");
    expect(controls.getByRole("link", { name: "www.example.org" })).toHaveAttribute("href", "https://www.example.org");
    expect(controls.getByRole("link", { name: "user+chat@example.com" })).toHaveAttribute("href", "mailto:user+chat@example.com");
    expect(controls.getByRole("link", { name: "8 (800) 555-35-35" })).toHaveAttribute("href", "tel:+78005553535");
    expect(message.querySelector("code")).toHaveTextContent("https://code.example.com");
    expect(controls.queryByRole("link", { name: "https://code.example.com" })).not.toBeInTheDocument();
    expect(controls.queryByRole("link", { name: "ошибка" })).not.toBeInTheDocument();
    expect(message.querySelector("img")).toBeNull();
  });

  it("shows a saved link card and ignores late previews for an edited URL", async () => {
    const oldPreview = { url: "https://example.com/old", title: "Старая статья", description: "Описание" };
    const newPreview = { url: "https://example.com/new", title: "Новая статья" };
    const message = { ...audioMessage, text: oldPreview.url, attachments: [], link_preview: oldPreview };
    apiMocks.listMessages.mockResolvedValue([message]);
    renderChat();
    const controls = within(await findMessage());
    expect(controls.getByRole("link", { name: /Старая статья/ })).toHaveAttribute("href", oldPreview.url);
    act(() => {
      socketState.options!.onEvent("message:updated", { ...message, text: newPreview.url, link_preview: null });
      socketState.options!.onEvent("message:link-preview", { chat_id: chat.id, message_id: message.id, preview: newPreview });
      socketState.options!.onEvent("message:link-preview", { chat_id: chat.id, message_id: message.id, preview: oldPreview });
    });
    expect(controls.queryByText(oldPreview.title)).not.toBeInTheDocument();
    expect(controls.getByRole("link", { name: /Новая статья/ })).toHaveAttribute("href", newPreview.url);
  });

  it("shows pins outside the loaded history, opens them, and removes an unpinned entry", async () => {
    const oldPin = { ...audioMessage, id: "old-pin", text: "Важное старое сообщение", created_at: "2025-01-01T12:00:00Z", is_pinned: true };
    apiMocks.listPinnedMessages.mockResolvedValue([oldPin]);
    apiMocks.togglePin.mockResolvedValue(false);
    renderChat();
    const panel = await screen.findByRole("region", { name: "Закреплённые сообщения" });
    expect(await within(panel).findByText(oldPin.text)).toBeVisible();
    expect(document.getElementById("message-old-pin")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Перейти к закреплённому сообщению" }));
    expect(document.getElementById("message-old-pin")).toHaveTextContent(oldPin.text);
    fireEvent.click(within(panel).getByRole("button", { name: "Показать все закреплённые сообщения" }));
    fireEvent.click(within(panel).getByRole("button", { name: `Открепить: ${oldPin.text}` }));
    await waitFor(() => expect(apiMocks.togglePin).toHaveBeenCalledWith(chat.id, oldPin.id));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Закреплённые сообщения" })).not.toBeInTheDocument());
    expect(document.getElementById("message-old-pin")?.querySelector(".msg__pin-label")).toBeNull();
  });

  it("updates pins from websocket edits and removes thread pins when their root is deleted", async () => {
    renderChat();
    await findMessage();
    const pinned = { ...audioMessage, id: "remote-pin", text: "Закреплено участником", attachments: [], is_pinned: true };
    act(() => socketState.options!.onEvent("message:updated", pinned));
    const panel = screen.getByRole("region", { name: "Закреплённые сообщения" });
    expect(within(panel).getByText(pinned.text)).toBeVisible();
    act(() => socketState.options!.onEvent("message:updated", { ...pinned, text: "Обновлённый закреп" }));
    expect(within(panel).getByText("Обновлённый закреп")).toBeVisible();
    expect(within(panel).queryByText(pinned.text)).not.toBeInTheDocument();
    act(() => socketState.options!.onEvent("message:updated", { ...pinned, id: "reply-pin", thread_root_id: pinned.id }));
    act(() => socketState.options!.onEvent("message:deleted", { chat_id: chat.id, message_id: pinned.id }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Закреплённые сообщения" })).not.toBeInTheDocument());
  });

  it("keeps live pin changes when an older initial request finishes", async () => {
    let resolvePins!: (messages: Array<Record<string, unknown>>) => void;
    apiMocks.listPinnedMessages.mockImplementationOnce(() => new Promise((resolve) => { resolvePins = resolve; }));
    renderChat();
    await findMessage();
    const existing = { ...audioMessage, id: "existing-pin", text: "Сохранённый закреп", is_pinned: true };
    const live = { ...existing, id: "live-pin", text: "Новый закреп" };
    const removed = { ...existing, id: "removed-pin", text: "Уже откреплён" };
    act(() => {
      socketState.options!.onEvent("message:updated", live);
      socketState.options!.onEvent("message:updated", { ...removed, is_pinned: false });
    });
    await act(async () => resolvePins([existing, removed]));
    const panel = screen.getByRole("region", { name: "Закреплённые сообщения" });
    fireEvent.click(within(panel).getByRole("button", { name: "Показать все закреплённые сообщения" }));
    expect(within(panel).getByRole("list")).toHaveTextContent(existing.text);
    expect(within(panel).getByRole("list")).toHaveTextContent(live.text);
    expect(within(panel).queryByText(removed.text)).not.toBeInTheDocument();
  });

  it("opens a pinned thread reply even if it is outside the loaded thread page", async () => {
    const root = { ...audioMessage, id: "thread-root", text: "Обсуждение", attachments: [] };
    const reply = { ...root, id: "pinned-reply", text: "Важный ответ", thread_root_id: root.id, is_pinned: true };
    apiMocks.listPinnedMessages.mockResolvedValue([reply]);
    apiMocks.listThreadMessages.mockResolvedValue([root]);
    renderChat();
    const panel = await screen.findByRole("region", { name: "Закреплённые сообщения" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Перейти к закреплённому сообщению" }));
    await waitFor(() => expect(document.getElementById("message-pinned-reply")).toHaveTextContent(reply.text));
    expect(apiMocks.listThreadMessages).toHaveBeenCalledWith(chat.id, root.id);
    expect(document.querySelector(".active-thread-header")).toHaveTextContent("Тред: Важный ответ");
  });

  it("retries loading pins after a request failure", async () => {
    apiMocks.listPinnedMessages.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([{ ...audioMessage, text: "После повтора", is_pinned: true }]);
    renderChat();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Не удалось загрузить закреплённые сообщения");
    fireEvent.click(within(alert).getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("После повтора")).toBeVisible();
    expect(apiMocks.listPinnedMessages).toHaveBeenCalledTimes(2);
  });

  it("shows a persisted voice message preview and its time after loading chats", async () => {
    apiMocks.listChats.mockResolvedValue([{ ...chat, last_message: audioMessage }]);
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });
    expect(document.querySelector(".chat-item__preview")).toHaveTextContent("Голосовое сообщение");
    expect(document.querySelector(".chat-item__time")).toHaveAttribute("datetime", audioMessage.created_at);
  });

  it("updates the last message on edit and restores the preceding message after deletion", async () => {
    apiMocks.listChats.mockResolvedValue([{ ...chat, last_message: audioMessage }]);
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });
    act(() => socketState.options!.onEvent("message:updated", { ...audioMessage, text: "Новая версия" }));
    expect(document.querySelector(".chat-item__preview")).toHaveTextContent("Новая версия");
    apiMocks.listChats.mockResolvedValue([{ ...chat, last_message: { ...audioMessage, id: "older", text: "Предыдущее сообщение" } }]);
    act(() => socketState.options!.onEvent("message:deleted", { chat_id: chat.id, message_id: audioMessage.id }));
    await waitFor(() => expect(document.querySelector(".chat-item__preview")).toHaveTextContent("Предыдущее сообщение"));
  });

  it("labels a thread reply and ignores delayed older messages in the preview", async () => {
    apiMocks.listChats.mockResolvedValue([{ ...chat, last_message: audioMessage }]);
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });
    act(() => socketState.options!.onEvent("message:new", {
      ...audioMessage, id: "new-reply", text: "Обсуждаем", thread_root_id: audioMessage.id,
      created_at: "2026-01-02T12:00:00Z",
    }));
    expect(document.querySelector(".chat-item__preview")).toHaveTextContent("В треде: Обсуждаем");
    act(() => socketState.options!.onEvent("message:new", { ...audioMessage, id: "delayed", text: "Старое" }));
    expect(document.querySelector(".chat-item__preview")).toHaveTextContent("В треде: Обсуждаем");
  });

  it("highlights chats and updates the browser tab count for incoming messages", async () => {
    const otherChat = { ...chat, id: "chat-notification", title: "Чат с новым сообщением" };
    apiMocks.listChats.mockResolvedValue([chat, otherChat]);
    renderChat();
    await screen.findByText(otherChat.title, { selector: ".chat-item__title" });
    await waitFor(() => expect(socketState.connections.has(otherChat.id)).toBe(true));
    act(() => socketState.connections.get(otherChat.id)!.onEvent("message:new", {
      ...audioMessage, id: "new-notification", chat_id: otherChat.id, user_id: "another-user", text: "Привет",
    }));
    const chatRow = screen.getByText(otherChat.title, { selector: ".chat-item__title" }).closest(".chat-item") as HTMLElement;
    expect(chatRow).toHaveClass("chat-item--unread");
    expect(within(chatRow!).getByLabelText("1 новых сообщений")).toBeVisible();
    expect(document.title).toContain("(1)");
    fireEvent.click(chatRow!);
    await waitFor(() => expect(within(chatRow!).queryByLabelText("1 новых сообщений")).not.toBeInTheDocument());
  });

  it("opens a thread from the dropdown below the conversation", async () => {
    const root = { ...audioMessage, text: "Обсуждение релиза", thread_reply_count: 1 };
    const reply = { ...root, id: "thread-reply", thread_root_id: root.id, text: "Ответ в треде" };
    apiMocks.listMessages.mockResolvedValue([root]);
    apiMocks.listThreads.mockResolvedValue([root]);
    apiMocks.listThreadMessages.mockResolvedValue([root, reply]);
    renderChat();
    fireEvent.click(await screen.findByText(/Треды чата/));
    fireEvent.click(screen.getByRole("button", { name: /Обсуждение релиза/ }));
    expect(await screen.findByText("Ответ в треде")).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Треды этого чата" })).not.toBeInTheDocument();
    expect(apiMocks.listThreadMessages).toHaveBeenCalledWith(chat.id, root.id);
    fireEvent.click(screen.getByRole("button", { name: "Вернуться в чат" }));
    expect(screen.queryByText("Ответ в треде")).not.toBeInTheDocument();
  });

  it.each([1, -1])("replies on a horizontal swipe in direction %i and ignores vertical and cancelled gestures", async (direction) => {
    renderChat();
    const message = await findMessage();
    const touch = { pointerType: "touch", pointerId: 1, button: 0, isPrimary: true };
    fireEvent.pointerDown(message, { ...touch, clientX: 100, clientY: 20 });
    fireEvent.pointerMove(message, { ...touch, clientX: 105, clientY: 100 });
    fireEvent.pointerUp(message, { ...touch, clientX: 110, clientY: 110 });
    expect(screen.queryByLabelText("Отменить ответ")).not.toBeInTheDocument();
    const swipe = () => {
      fireEvent.pointerDown(message, { ...touch, clientX: 100, clientY: 20 });
      fireEvent.pointerMove(message, { ...touch, clientX: 100 + 80 * direction, clientY: 24 });
    };
    swipe();
    fireEvent.pointerCancel(message, touch);
    expect(message.style.translate).toBe("");
    expect(screen.queryByLabelText("Отменить ответ")).not.toBeInTheDocument();
    swipe();
    fireEvent.pointerUp(message, { ...touch, clientX: 100 + 80 * direction, clientY: 24 });
    expect(screen.getByLabelText("Отменить ответ")).toBeVisible();
    expect(screen.getByRole("button", { name: "В ответ tester Голосовое сообщение" })).toBeVisible();
  });

  it("shows the author's name and quote above the composer and cancels without clearing a draft", async () => {
    const author = { id: "other-user", username: "Макс Чёрный", tag: "max", role: "member", avatar_urls: [] };
    apiMocks.getChatMembers.mockResolvedValue([author]);
    apiMocks.listMessages.mockResolvedValue([{
      ...audioMessage, user_id: author.id, text: "Меня кстати\nне было", attachments: [],
    }]);
    renderChat();
    const message = await findMessage();
    const input = screen.getByPlaceholderText("Написать сообщение…");
    fireEvent.change(input, { target: { value: "Мой черновик" } });
    fireEvent.contextMenu(message);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Ответить" }));
    expect(screen.getByRole("button", { name: "В ответ Макс Чёрный Меня кстати не было" })).toBeVisible();
    expect(input).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Отменить ответ" }));
    expect(screen.queryByRole("button", { name: /^В ответ Макс Чёрный/ })).not.toBeInTheDocument();
    expect(input).toHaveValue("Мой черновик");
    expect(input).toHaveFocus();
  });

  it("opens message actions from a touch hold and from the keyboard", async () => {
    renderChat();
    const message = await findMessage();
    const actions = { name: "Действия с сообщением" };
    const touch = { pointerType: "touch", pointerId: 1, button: 0, isPrimary: true, clientX: 100, clientY: 120 };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.pointerDown(message, touch);
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    vi.useRealTimers();
    fireEvent.pointerUp(message, touch);
    const menu = screen.getByRole("dialog", actions);
    expect(within(menu).getByRole("button", { name: "Ответить" })).toBeVisible();
    expect(screen.queryByLabelText("Отменить ответ")).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    message.focus();
    fireEvent.keyDown(message, { key: "F10", shiftKey: true });
    expect(screen.getByRole("dialog", actions)).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(message).toHaveFocus();
  });

  it("forwards the chosen message to the selected chat", async () => {
    apiMocks.listChats.mockResolvedValue([chat, { ...chat, id: "chat-2", title: "Второй чат" }]);
    apiMocks.forwardMessage.mockResolvedValue({ ...audioMessage, id: "forward-copy", chat_id: "chat-2" });
    renderChat();
    fireEvent.contextMenu(await findMessage());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Переслать" }));
    const dialog = screen.getByRole("dialog", { name: "Переслать сообщение" });
    fireEvent.change(within(dialog).getByLabelText("Куда переслать"), { target: { value: "chat-2" } });
    fireEvent.change(within(dialog).getByLabelText("Подпись к пересылке"), { target: { value: "Мой комментарий" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Переслать" }));
    await waitFor(() => expect(apiMocks.forwardMessage).toHaveBeenCalledWith(chat.id, audioMessage.id, "chat-2", audioMessage.text, "Мой комментарий"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers message actions on right click and pins the selected message", async () => {
    apiMocks.togglePin.mockResolvedValue(true);
    renderChat();
    const message = await findMessage();
    expect(within(message).queryByRole("button", { name: "Ответить" })).not.toBeInTheDocument();
    expect(within(message).queryByRole("button", { name: "Действия с сообщением" })).not.toBeInTheDocument();
    fireEvent.contextMenu(message, { clientX: 100, clientY: 120 });
    const menu = screen.getByRole("dialog", { name: "Действия с сообщением" });
    expect(within(menu).getByRole("button", { name: "Изменить" })).toBeVisible();
    expect(within(menu).getByRole("button", { name: "Удалить" })).toBeVisible();
    fireEvent.click(within(menu).getByRole("button", { name: "Закрепить" }));
    await waitFor(() => expect(apiMocks.togglePin).toHaveBeenCalledWith(chat.id, audioMessage.id));
    expect(screen.queryByRole("dialog", { name: "Действия с сообщением" })).not.toBeInTheDocument();
  });

  it("edits and deletes the message chosen in the context menu", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("Исправленный текст");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiMocks.updateMessage.mockResolvedValue({ ...audioMessage, text: "Исправленный текст" });
    apiMocks.deleteMessage.mockResolvedValue(undefined);
    renderChat();
    fireEvent.contextMenu(await findMessage());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Изменить" }));
    expect(await screen.findByText("Исправленный текст")).toBeVisible();
    expect(apiMocks.updateMessage).toHaveBeenCalledWith(audioMessage.id, "Исправленный текст");
    fireEvent.contextMenu(await findMessage());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(document.getElementById("message-message-1")).toBeNull());
    expect(apiMocks.deleteMessage).toHaveBeenCalledWith(audioMessage.id);
  });

  it("hides edit and delete for other authors and closes actions on Escape", async () => {
    apiMocks.getChatMembers.mockResolvedValue([
      { id: "other-user", username: "Другой участник", tag: "other", role: "member" },
    ]);
    apiMocks.listMessages.mockResolvedValue([{ ...audioMessage, user_id: "other-user" }]);
    renderChat();
    const message = await findMessage();
    expect(message).not.toHaveClass("msg--me");
    await screen.findByText("Другой участник");
    expect(message.querySelector(".msg__author")).toHaveTextContent("Другой участник");
    fireEvent.contextMenu(message);
    const menu = screen.getByRole("dialog", { name: "Действия с сообщением" });
    expect(within(menu).queryByRole("button", { name: "Изменить" })).not.toBeInTheDocument();
    expect(within(menu).queryByRole("button", { name: "Удалить" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens search on demand and expands filters separately", async () => {
    apiMocks.searchMessages.mockResolvedValue([]);
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });
    expect(screen.queryByRole("textbox", { name: "Поиск по сообщениям" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть поиск" }));
    expect(screen.getByLabelText("Тип вложения")).not.toBeVisible();
    fireEvent.click(screen.getByText("Фильтры", { selector: "summary" }));
    expect(screen.getByLabelText("Тип вложения")).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск по сообщениям" }), { target: { value: "проект" } });
    fireEvent.change(screen.getByLabelText("Тип вложения"), { target: { value: "image" } });
    fireEvent.click(screen.getByRole("button", { name: "Найти" }));
    await waitFor(() => expect(apiMocks.searchMessages).toHaveBeenCalledWith(chat.id, expect.objectContaining({ text: "проект", attachment_type: "image" })));
  });

  it("opens scheduling on hold without sending and still sends on a normal click", async () => {
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });
    fireEvent.change(document.querySelector(".chat-view__composer textarea")!, { target: { value: "Позже" } });
    const send = screen.getByRole("button", { name: "Отправить" });
    expect(screen.queryByRole("dialog", { name: "Отложенная отправка" })).not.toBeInTheDocument();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fireEvent.pointerDown(send, { button: 0 });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    vi.useRealTimers();
    fireEvent.pointerUp(send);
    fireEvent.click(send);
    expect(screen.getByRole("dialog", { name: "Отложенная отправка" })).toBeVisible();
    expect(apiMocks.sendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    fireEvent.click(send);
    await waitFor(() => expect(apiMocks.sendMessage).toHaveBeenCalledWith(chat.id, expect.objectContaining({ text: "Позже" })));
  });

  it("queues a scheduled message without calling the send API", async () => {
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });
    fireEvent.change(document.querySelector(".chat-view__composer textarea")!, { target: { value: "По расписанию" } });
    fireEvent.keyDown(screen.getByRole("button", { name: "Отправить" }), { key: "ArrowDown" });
    const future = new Date(Date.now() + 86400000);
    const localTime = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    fireEvent.change(screen.getByLabelText("Отправить позже"), { target: { value: localTime } });
    fireEvent.click(screen.getByRole("button", { name: "Запланировать" }));
    expect(JSON.parse(localStorage.getItem("scheduled-messages")!)).toEqual([
      expect.objectContaining({ chatId: chat.id, text: "По расписанию", at: new Date(localTime).toISOString() }),
    ]);
    expect(apiMocks.sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Отложенная отправка" })).not.toBeInTheDocument();
  });

  it("opens the AI assistant from the active chat", async () => {
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });

    fireEvent.click(screen.getByRole("button", { name: "Открыть ИИ-помощника" }));

    expect(screen.getByRole("complementary", { name: "Помощник по чату" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сделать сводку" })).toBeInTheDocument();
  });
});
