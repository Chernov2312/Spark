import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatsPage from "./ChatsPage.jsx";
import { act, within } from "@testing-library/react";

const { apiMocks, socialMocks, socketState } = vi.hoisted(() => ({
  apiMocks: {
    listChats: vi.fn(),
    listMessages: vi.fn(),
    transcribeAttachment: vi.fn(),
    uploadAttachment: vi.fn(),
    getAttachmentDownloadUrl: vi.fn(),
    sendMessage: vi.fn(),
    togglePin: vi.fn(),
    searchMessages: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    listThreads: vi.fn(),
    listThreadMessages: vi.fn(),
    forwardMessage: vi.fn(),
    setPersonalChatAvatar: vi.fn(),
    resetPersonalChatAvatar: vi.fn(),
  },
  socialMocks: {
    listFriends: vi.fn(),
    listChatFolders: vi.fn(),
  },
  socketState: {
    options: null as null | {
      onEvent: (event: string, data: Record<string, unknown>) => void;
    },
  },
}));

vi.mock("../api", () => ({
  chats: {
    listChats: apiMocks.listChats,
    setPersonalChatAvatar: apiMocks.setPersonalChatAvatar,
    resetPersonalChatAvatar: apiMocks.resetPersonalChatAvatar,
  },
  social: socialMocks,
  messages: {
    listMessages: apiMocks.listMessages,
    sendMessage: apiMocks.sendMessage,
    transcribeAttachment: apiMocks.transcribeAttachment,
    togglePin: apiMocks.togglePin,
    searchMessages: apiMocks.searchMessages,
    updateMessage: apiMocks.updateMessage,
    deleteMessage: apiMocks.deleteMessage,
    listThreads: apiMocks.listThreads,
    listThreadMessages: apiMocks.listThreadMessages,
    forwardMessage: apiMocks.forwardMessage,
  },
  attachments: {
    uploadAttachment: apiMocks.uploadAttachment,
    getAttachmentDownloadUrl: apiMocks.getAttachmentDownloadUrl,
  },
  auth: {
    isAuthenticated: () => true,
    getCurrentUser: () => ({ id: "user-1", username: "tester" }),
  },
  createChatSocket: vi.fn((_chatId, options) => {
    socketState.options = options;
    return { close: vi.fn(), send: vi.fn() };
  }),
  translateApiError: (_error: unknown, fallback: string) => fallback,
}));

const chat = {
  id: "chat-1",
  title: "Тестовый чат",
  description: "",
  avatar_urls: [],
};

const audioMessage = {
  id: "message-1",
  chat_id: chat.id,
  user_id: "user-1",
  text: null,
  created_at: "2026-01-01T12:00:00Z",
  attachments: [
    {
      id: "attachment-1",
      file_key: "https://storage.test/audio.ogg",
      file_name: "audio.ogg",
      mime_type: "audio/ogg",
      text: null,
    },
  ],
};

function renderChat() {
  return render(
    <MemoryRouter initialEntries={[`/chats/${chat.id}`]}>
      <Routes>
        <Route path="/chats/:chatId" element={<ChatsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ChatsPage media controls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem("access_token", "test-token");
    localStorage.setItem("user", JSON.stringify({ id: "user-1" }));
    apiMocks.listChats.mockResolvedValue([chat]);
    apiMocks.listMessages.mockResolvedValue([audioMessage]);
    apiMocks.listThreads.mockResolvedValue([]);
    apiMocks.listThreadMessages.mockResolvedValue([audioMessage]);
    socialMocks.listFriends.mockResolvedValue({
      friends: [],
      requests: [],
      categories: [],
    });
    socialMocks.listChatFolders.mockResolvedValue([]);
    apiMocks.transcribeAttachment.mockResolvedValue({ queued: true });
    apiMocks.getAttachmentDownloadUrl.mockResolvedValue(
      "https://storage.test/download/audio.ogg",
    );
    apiMocks.uploadAttachment.mockImplementation(async (file) => ({
      id: `uploaded-${file.name}`,
      file_key: `https://storage.test/${file.name}`,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type,
      text: null,
    }));
    apiMocks.sendMessage.mockImplementation(async (chatId, body) => ({
      id: "sent-message",
      chat_id: chatId,
      user_id: "user-1",
      text: body.text,
      attachments: body.attachments,
      created_at: "2026-01-01T12:00:00Z",
    }));
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:chat-image-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    socketState.options = null;
  });

  it("opens the chat profile from its title and icon without profile tabs", async () => {
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });
    expect(screen.queryByRole("tab", { name: "Профиль чата" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Переписка" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `О чате ${chat.title}` }));
    expect(screen.getByRole("region", { name: "Информация о чате" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "← Вернуться к сообщениям" }));
    expect(screen.queryByRole("region", { name: "Информация о чате" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Открыть информацию о чате" }));
    expect(screen.getByRole("region", { name: "Информация о чате" })).toBeVisible();
  });

  it("saves a personal avatar in both the header and sidebar and restores the shared avatar", async () => {
    apiMocks.setPersonalChatAvatar.mockResolvedValue({ personal_avatar_url: "https://storage.test/personal.png" });
    apiMocks.resetPersonalChatAvatar.mockResolvedValue({ personal_avatar_url: null });
    apiMocks.listChats.mockResolvedValue([{ ...chat, avatar_urls: ["https://storage.test/shared.png"] }]);
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    const file = new File(["picture"], "personal.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Моя картинка чата"), { target: { files: [file] } });
    await waitFor(() => expect(apiMocks.setPersonalChatAvatar).toHaveBeenCalledWith(chat.id, file));
    await waitFor(() => expect(document.querySelector(".chat-profile-trigger--avatar img")).toHaveAttribute("src", "https://storage.test/personal.png"));
    expect(document.querySelector(".chats-sidebar .chat-item__avatar img")).toHaveAttribute("src", "https://storage.test/personal.png");
    fireEvent.click(screen.getByRole("button", { name: "Вернуть общую картинку" }));
    await waitFor(() => expect(document.querySelector(".chat-profile-trigger--avatar img")).toHaveAttribute("src", "https://storage.test/shared.png"));
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
    fireEvent.pointerDown(send, { button: 0 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
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

  it("shows a local image preview and removes it from the composer", async () => {
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });

    const file = new File(["image-bytes"], "photo.png", { type: "image/png" });
    const input = document.querySelector(
      ".chat-view__composer input[type='file']",
    );
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });

    const preview = await screen.findByRole("img", { name: "photo.png" });
    expect(preview).toHaveAttribute("src", "blob:chat-image-preview");
    fireEvent.click(document.querySelector(".composer-attachments__remove")!);
    await waitFor(() => {
      expect(screen.queryByRole("img", { name: "photo.png" })).not.toBeInTheDocument();
    });
  });

  it("opens the AI assistant from the active chat", async () => {
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });

    fireEvent.click(screen.getByRole("button", { name: "Открыть ИИ-помощника" }));

    expect(screen.getByRole("complementary", { name: "Помощник по чату" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сделать сводку" })).toBeInTheDocument();
  });

  it("downloads audio through the authenticated attachment endpoint", async () => {
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });

    fireEvent.click(await screen.findByRole("button", { name: "Скачать audio.ogg" }));

    await waitFor(() => {
      expect(apiMocks.getAttachmentDownloadUrl).toHaveBeenCalledWith("attachment-1");
    });
  });

  it("starts audio transcription only after the user requests it", async () => {
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });

    const transcribeButton = await screen.findByRole("button", {
      name: "Распознать",
    });
    expect(apiMocks.transcribeAttachment).not.toHaveBeenCalled();

    fireEvent.click(transcribeButton);
    await waitFor(() => {
      expect(apiMocks.transcribeAttachment).toHaveBeenCalledWith(
        chat.id,
        audioMessage.id,
        audioMessage.attachments[0].id,
      );
    });
    expect(await screen.findByText("Распознавание…")).toBeInTheDocument();

    socketState.options?.onEvent("attachment:text", {
      chat_id: chat.id,
      message_id: audioMessage.id,
      attachment_id: audioMessage.attachments[0].id,
      text: "Привет, это распознанный текст.",
      error: false,
    });
    expect(
      await screen.findByText("Привет, это распознанный текст."),
    ).toBeInTheDocument();
  });

  it("opens a combined image and video gallery with download and keyboard controls", async () => {
    apiMocks.listMessages.mockResolvedValue([
      {
        ...audioMessage,
        attachments: [
          {
            id: "image-1",
            file_key: "https://storage.test/photo.jpg",
            file_name: "photo.jpg",
            mime_type: "image/jpeg",
          },
          {
            id: "video-1",
            file_key: "https://storage.test/clip.mp4",
            file_name: "clip.mp4",
            mime_type: "video/mp4",
          },
        ],
      },
    ]);
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });

    fireEvent.click(await screen.findByRole("button", { name: "Открыть photo.jpg" }));
    const viewer = screen.getByRole("dialog", { name: "Просмотр вложения" });
    expect(viewer.querySelector("img")).toHaveAttribute(
      "src",
      "https://storage.test/photo.jpg",
    );
    expect(screen.getByRole("button", { name: "Скачать оригинал" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Следующее вложение" }));
    expect(viewer.querySelector("video")).toHaveAttribute(
      "src",
      "https://storage.test/clip.mp4",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("sends selected photos together and always compresses them", async () => {
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });
    const files = [
      new File(["first"], "first.png", { type: "image/png" }),
      new File(["second"], "second.jpg", { type: "image/jpeg" }),
    ];
    fireEvent.change(
      document.querySelector(".chat-view__composer input[type='file']")!,
      { target: { files } },
    );
    fireEvent.click(document.querySelector(".composer-btn--send")!);

    await waitFor(() => {
      expect(apiMocks.sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.uploadAttachment).toHaveBeenNthCalledWith(1, files[0], chat.id, {
      compressImages: true,
    });
    expect(apiMocks.uploadAttachment).toHaveBeenNthCalledWith(2, files[1], chat.id, {
      compressImages: true,
    });
    expect(apiMocks.sendMessage.mock.calls[0][1].attachments).toHaveLength(2);
  });

  it("shows audio duration and cycles playback speed", async () => {
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });

    const speedButton = await screen.findByRole("button", {
      name: "Скорость воспроизведения 1x",
    });
    fireEvent.click(speedButton);
    expect(
      screen.getByRole("button", { name: "Скорость воспроизведения 1.25x" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Длительность аудио")).toHaveTextContent("0:00 / 0:00");
  });

  it("records and sends a voice note without requiring a caption", async () => {
    class FakeMediaRecorder {
      static isTypeSupported = () => true;

      mimeType = "audio/webm;codecs=opus";
      state = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["voice bytes"], { type: this.mimeType }),
        });
        this.onstop?.();
      }
    }
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });

    fireEvent.click(
      screen.getByRole("button", { name: "Записать голосовое сообщение" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Завершить запись" }));

    expect(
      await screen.findByText("Предпрослушивание голосового сообщения"),
    ).toBeInTheDocument();
    expect(track.stop).toHaveBeenCalled();
    fireEvent.click(document.querySelector(".composer-btn--send")!);

    await waitFor(() => expect(apiMocks.sendMessage).toHaveBeenCalledTimes(1));
    expect(apiMocks.sendMessage.mock.calls[0][1].text).toBeNull();
    expect(apiMocks.sendMessage.mock.calls[0][1].attachments).toHaveLength(1);
    expect(apiMocks.sendMessage.mock.calls[0][1].attachments[0].mime_type).toMatch(
      /^audio\/webm/,
    );
    expect(document.querySelector(".msg .audio-player audio")).not.toBeNull();
  });
});

