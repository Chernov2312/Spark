import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { apiMocks, audioMessage, chat, renderChat, socketState, setupChatTests } from "../test/chatHarness";

setupChatTests();

describe("ChatsPage: messages", () => {
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
    await screen.findByRole("button", { name: "Действия с сообщением" });
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
    await screen.findByRole("button", { name: "Действия с сообщением" });
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
    expect(screen.getByRole("tab", { name: "Треды этого чата" })).toHaveAttribute("aria-selected", "true");
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

  it("opens a thread from the menu and selects it in the left sidebar", async () => {
    const root = { ...audioMessage, text: "Обсуждение релиза", thread_reply_count: 1 };
    const reply = { ...root, id: "thread-reply", thread_root_id: root.id, text: "Ответ в треде" };
    apiMocks.listMessages.mockResolvedValue([root]);
    apiMocks.listThreads.mockResolvedValue([root]);
    apiMocks.listThreadMessages.mockResolvedValue([root, reply]);
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Действия с сообщением" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Открыть тред" }));
    expect(await screen.findByText("Ответ в треде")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Треды этого чата" })).toHaveAttribute("aria-selected", "true");
    expect(apiMocks.listThreadMessages).toHaveBeenCalledWith(chat.id, root.id);
    fireEvent.click(screen.getByRole("button", { name: "Вернуться в чат" }));
    expect(screen.queryByText("Ответ в треде")).not.toBeInTheDocument();
  });

  it("replies on a horizontal swipe without treating vertical scrolling as a reply", async () => {
    renderChat();
    await screen.findByRole("button", { name: "Действия с сообщением" });
    const message = document.getElementById("message-message-1")!;
    fireEvent.pointerDown(message, { pointerType: "touch", clientX: 20, clientY: 20 });
    fireEvent.pointerMove(message, { pointerType: "touch", clientX: 25, clientY: 100 });
    fireEvent.pointerUp(message, { pointerType: "touch", clientX: 30, clientY: 110 });
    expect(screen.queryByLabelText("Отменить ответ")).not.toBeInTheDocument();
    fireEvent.pointerDown(message, { pointerType: "touch", clientX: 20, clientY: 20 });
    fireEvent.pointerMove(message, { pointerType: "touch", clientX: 100, clientY: 24 });
    fireEvent.pointerUp(message, { pointerType: "touch", clientX: 100, clientY: 24 });
    expect(screen.getByLabelText("Отменить ответ")).toBeVisible();
  });

  it("forwards the chosen message to the selected chat", async () => {
    apiMocks.listChats.mockResolvedValue([chat, { ...chat, id: "chat-2", title: "Второй чат" }]);
    apiMocks.forwardMessage.mockResolvedValue({ ...audioMessage, id: "forward-copy", chat_id: "chat-2" });
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Действия с сообщением" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Переслать" }));
    const dialog = screen.getByRole("dialog", { name: "Переслать сообщение" });
    fireEvent.change(within(dialog).getByLabelText("Куда переслать"), { target: { value: "chat-2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Переслать" }));
    await waitFor(() => expect(apiMocks.forwardMessage).toHaveBeenCalledWith(chat.id, audioMessage.id, "chat-2"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("offers message actions on right click and pins the selected message", async () => {
    apiMocks.togglePin.mockResolvedValue(true);
    renderChat();
    await screen.findByRole("button", { name: "Действия с сообщением" });
    fireEvent.contextMenu(document.getElementById("message-message-1")!, { clientX: 100, clientY: 120 });
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
    fireEvent.click(await screen.findByRole("button", { name: "Действия с сообщением" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Изменить" }));
    expect(await screen.findByText("Исправленный текст")).toBeVisible();
    expect(apiMocks.updateMessage).toHaveBeenCalledWith(audioMessage.id, "Исправленный текст");
    fireEvent.click(screen.getByRole("button", { name: "Действия с сообщением" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(document.getElementById("message-message-1")).toBeNull());
    expect(apiMocks.deleteMessage).toHaveBeenCalledWith(audioMessage.id);
  });

  it("hides edit and delete for other authors and closes actions on Escape", async () => {
    apiMocks.listMessages.mockResolvedValue([{ ...audioMessage, user_id: "other-user" }]);
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Действия с сообщением" }));
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
