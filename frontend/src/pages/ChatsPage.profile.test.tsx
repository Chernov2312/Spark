import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { apiMocks, chat, renderChat, setupChatTests } from "../test/chatHarness";

setupChatTests();

describe("ChatsPage: profile", () => {
  it("lets a chat member leave after confirmation", async () => {
    apiMocks.leaveChat.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    fireEvent.click(screen.getByRole("button", { name: "Выйти из чата" }));
    await waitFor(() => expect(apiMocks.leaveChat).toHaveBeenCalledWith(chat.id));
    expect(await screen.findByText("Выберите чат слева или создайте новый")).toBeVisible();
  });

  it("lets the owner delete the chat for everyone after confirmation", async () => {
    apiMocks.listChats.mockResolvedValue([{ ...chat, owner_id: "user-1" }]);
    apiMocks.deleteChat.mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    fireEvent.click(screen.getByRole("button", { name: "Удалить чат для всех" }));
    await waitFor(() => expect(apiMocks.deleteChat).toHaveBeenCalledWith(chat.id));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Переписка будет удалена"));
    expect(await screen.findByText("Выберите чат слева или создайте новый")).toBeVisible();
  });

  it("restores saved preferences in StrictMode without overwriting them on mount", async () => {
    const preferences = { color: "#7654ab", muted: true, sound: false };
    localStorage.setItem(`chat-prefs:${chat.id}`, JSON.stringify(preferences));
    renderChat(`/chats/${chat.id}`, true);
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    fireEvent.click(screen.getByRole("button", { name: "Настройки чата" }));
    expect(screen.getByRole("switch", { name: "Без уведомлений" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Звук" })).not.toBeChecked();
    expect(screen.getByLabelText("Цвет чата")).toHaveValue(preferences.color);
    expect(JSON.parse(localStorage.getItem(`chat-prefs:${chat.id}`)!)).toMatchObject(preferences);
  });

  it("keeps each chat's preferences separate when navigating between chats", async () => {
    const second = { ...chat, id: "chat-2", title: "Второй чат" };
    apiMocks.listChats.mockResolvedValue([chat, second]);
    localStorage.setItem(`chat-prefs:${chat.id}`, JSON.stringify({ sound: false }));
    localStorage.setItem(`chat-prefs:${second.id}`, JSON.stringify({ sound: true, muted: true }));
    renderChat(`/chats/${chat.id}`, true);
    fireEvent.click(await screen.findByText(second.title, { selector: ".chat-item__title" }));
    await waitFor(() => expect(apiMocks.getChatMembers).toHaveBeenCalledWith(second.id));
    fireEvent.click(screen.getByRole("button", { name: "Открыть информацию о чате" }));
    fireEvent.click(screen.getByRole("button", { name: "Настройки чата" }));
    expect(screen.getByRole("switch", { name: "Звук" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Без уведомлений" })).toBeChecked();
    expect(JSON.parse(localStorage.getItem(`chat-prefs:${chat.id}`)!)).toMatchObject({ sound: false });
    expect(JSON.parse(localStorage.getItem(`chat-prefs:${second.id}`)!)).toMatchObject({ sound: true, muted: true });
  });

  it("lets a regular member browse all shared avatars separately from their personal picture", async () => {
    apiMocks.listChats.mockResolvedValue([{ ...chat, owner_id: "owner-2", avatar_urls: ["https://storage.test/old.png", "https://storage.test/new.png", "https://storage.test/latest.gif"], personal_avatar_url: "https://storage.test/personal.png" }]);
    apiMocks.getChatMembers.mockResolvedValue([{ id: "user-1", username: "tester", role: "member" }]);
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    const gallery = screen.getByRole("region", { name: "Аватарки группы" });
    expect(within(gallery).getAllByRole("button", { name: /Открыть аватарку группы/ })).toHaveLength(3);
    expect(within(gallery).getByText("Текущая").closest("button")?.querySelector("img")).toHaveAttribute("src", "https://storage.test/latest.gif");
    expect(gallery.querySelector('img[src="https://storage.test/personal.png"]')).toBeNull();
    expect(screen.queryByLabelText("Добавить общее фото чата")).not.toBeInTheDocument();
    const trigger = within(gallery).getByRole("button", { name: "Открыть аватарку группы 2" });
    trigger.focus();
    fireEvent.click(trigger);
    const viewer = screen.getByRole("dialog", { name: "Просмотр аватарок группы" });
    expect(viewer.querySelector("img")).toHaveAttribute("src", "https://storage.test/new.png");
    expect(within(viewer).getByText("2 / 3")).toBeVisible();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(viewer.querySelector("img")).toHaveAttribute("src", "https://storage.test/old.png");
    fireEvent.click(within(viewer).getByRole("button", { name: "Следующая аватарка" }));
    expect(viewer.querySelector("img")).toHaveAttribute("src", "https://storage.test/latest.gif");
    expect(within(viewer).getByText("1 / 3")).toBeVisible();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(viewer.querySelector("img")).toHaveAttribute("src", "https://storage.test/old.png");
    expect(within(viewer).queryByRole("button", { name: "Скачать оригинал" })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(within(gallery).getByRole("button", { name: "Смотреть все" }));
    expect(screen.getByRole("dialog").querySelector("img")).toHaveAttribute("src", "https://storage.test/latest.gif");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть просмотр" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a single shared avatar without navigation controls", async () => {
    apiMocks.listChats.mockResolvedValue([{ ...chat, avatar_url: "https://storage.test/single.png" }]);
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    fireEvent.click(screen.getByRole("button", { name: "Открыть аватарку группы 1" }));
    const viewer = screen.getByRole("dialog", { name: "Просмотр аватарок группы" });
    expect(viewer.querySelector("img")).toHaveAttribute("src", "https://storage.test/single.png");
    expect(within(viewer).getByText("1 / 1")).toBeVisible();
    expect(within(viewer).queryByRole("button", { name: "Следующая аватарка" })).not.toBeInTheDocument();
    expect(within(viewer).queryByRole("button", { name: "Предыдущая аватарка" })).not.toBeInTheDocument();
    fireEvent.mouseDown(document.querySelector(".media-viewer-backdrop")!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows an empty shared gallery even when a personal chat picture is set", async () => {
    apiMocks.listChats.mockResolvedValue([{ ...chat, personal_avatar_url: "https://storage.test/personal.png" }]);
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    const gallery = screen.getByRole("region", { name: "Аватарки группы" });
    expect(within(gallery).getByText("У группы пока нет общих аватарок.")).toBeVisible();
    expect(within(gallery).queryByRole("button", { name: "Смотреть все" })).not.toBeInTheDocument();
  });

  it.each([
    ["owner", true], ["moderator", true], ["member", false],
  ])("limits shared photo controls for role %s while keeping personal photos", async (role, allowed) => {
    const roleChat = { ...chat, owner_id: role === "owner" ? "user-1" : "owner-2" };
    apiMocks.listChats.mockResolvedValue([roleChat]);
    apiMocks.getChatMembers.mockResolvedValue([{ id: "user-1", username: "tester", role }]);
    apiMocks.uploadChatAvatars.mockResolvedValue([]);
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    await screen.findByRole("button", { name: "Открыть профиль tester" });
    expect(screen.getByLabelText("Моя картинка чата")).toBeInTheDocument();
    if (allowed) {
      const file = new File(["image"], "shared.png", { type: "image/png" });
      fireEvent.change(screen.getByLabelText("Добавить общее фото чата"), { target: { files: [file] } });
      await waitFor(() => expect(apiMocks.uploadChatAvatars).toHaveBeenCalledWith(chat.id, [file]));
    } else {
      expect(screen.queryByText("Добавить общее фото чата")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Добавить общее фото чата")).not.toBeInTheDocument();
      expect(apiMocks.uploadChatAvatars).not.toHaveBeenCalled();
    }
  });

  it("opens grouped chat settings and persists changes when the dropdown closes", async () => {
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    const trigger = screen.getByRole("button", { name: "Настройки чата" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Цвет чата")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const panel = screen.getByRole("dialog", { name: "Настройки чата" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    for (const name of ["Оформление", "Уведомления", "Приватность"]) {
      expect(within(panel).getByRole("heading", { name })).toBeVisible();
    }
    fireEvent.click(within(panel).getByRole("switch", { name: "Без уведомлений" }));
    fireEvent.click(within(panel).getByRole("switch", { name: "Звук" }));
    fireEvent.change(within(panel).getByLabelText("Цвет чата"), { target: { value: "#7654ab" } });
    fireEvent.change(within(panel).getByLabelText("Фон", { exact: true }), { target: { value: "#101020" } });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(`chat-prefs:${chat.id}`)!)).toMatchObject({ muted: true, sound: false, color: "#7654ab", background: "#101020" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    expect(screen.getByRole("switch", { name: "Без уведомлений" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Звук" })).not.toBeChecked();
    expect(screen.getByLabelText("Цвет чата")).toHaveValue("#7654ab");
  });

  it("dismisses chat settings on an outside press or a second trigger click", async () => {
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    const trigger = screen.getByRole("button", { name: "Настройки чата" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole("heading", { name: "О чате" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("requests browser notifications only on click and displays the resulting permission", async () => {
    const requestPermission = vi.fn().mockResolvedValue("granted");
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    fireEvent.click(screen.getByRole("button", { name: "Настройки чата" }));
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Включить уведомления" }));
    expect(await screen.findByRole("button", { name: "Уведомления разрешены" })).toBeDisabled();
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("previews selected group avatars, removes them, and releases previews on close", async () => {
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Создать чат" }));
    const dialog = screen.getByRole("dialog", { name: "Новая группа" });
    const first = new File(["photo"], "first.png", { type: "image/png" });
    const second = new File(["photo"], "second.webp", { type: "image/webp" });
    fireEvent.change(within(dialog).getByLabelText("Аватарки группы"), { target: { files: [first, second] } });
    expect(await within(dialog).findByAltText("Превью аватарки группы")).toHaveAttribute("src", within(dialog).getByAltText("Превью second.webp").getAttribute("src"));
    expect(within(dialog).getByAltText("Превью first.png")).toBeVisible();
    expect(within(dialog).getByAltText("Превью second.webp")).toBeVisible();
    fireEvent.click(within(dialog).getByRole("button", { name: "Убрать second.webp" }));
    expect(within(dialog).queryByAltText("Превью second.webp")).not.toBeInTheDocument();
    expect(within(dialog).getByAltText("Превью first.png")).toBeVisible();
    expect(within(dialog).getByAltText("Превью аватарки группы")).toHaveAttribute("src", within(dialog).getByAltText("Превью first.png").getAttribute("src"));
    const revokedBeforeClose = vi.mocked(URL.revokeObjectURL).mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(vi.mocked(URL.revokeObjectURL).mock.calls.length).toBeGreaterThan(revokedBeforeClose);
  });

  it("rejects unsupported group avatars before creating a preview", async () => {
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Создать чат" }));
    fireEvent.change(screen.getByLabelText("Аватарки группы"), { target: { files: [new File(["text"], "file.txt", { type: "text/plain" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Поддерживаются только JPEG, PNG, WebP и GIF");
    expect(screen.queryByAltText("Превью аватарки группы")).not.toBeInTheDocument();
  });

  it("shows participants only in chat details and opens their profiles", async () => {
    apiMocks.getChatMembers.mockResolvedValue([
      { id: "user-1", username: "tester", tag: "tester", role: "owner", avatar_urls: [] },
      { id: "user-2", username: "Анна", tag: "anna", role: "moderator", avatar_urls: ["https://storage.test/old.png", "https://storage.test/anna.png"], created_at: "2026-01-01T12:00:00Z" },
    ]);
    renderChat();
    const detailsButton = await screen.findByRole("button", { name: "Открыть информацию о чате" });
    expect(screen.queryByText("Участники", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Открыть профиль Анна" })).not.toBeInTheDocument();
    fireEvent.click(detailsButton);
    const members = screen.getByRole("region", { name: "Участники чата" });
    const trigger = await within(members).findByRole("button", { name: "Открыть профиль Анна" });
    expect(within(members).getByRole("button", { name: "Открыть профиль tester" })).toHaveTextContent("Владелец");
    expect(trigger).toHaveTextContent("Модератор");
    expect(trigger.querySelector("img")).toHaveAttribute("src", "https://storage.test/anna.png");
    trigger.focus();
    fireEvent.click(trigger);
    const profile = screen.getByRole("dialog", { name: "Анна" });
    expect(within(profile).getByText("@anna")).toBeVisible();
    expect(within(profile).getByText(chat.title)).toBeVisible();
    expect(within(profile).getByText("1 января 2026 г.")).toBeVisible();
    fireEvent.click(within(profile).getByRole("button", { name: "Фото профиля 1" }));
    expect(profile.querySelector(".member-avatar--large img")).toHaveAttribute("src", "https://storage.test/old.png");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Свернуть" }));
    expect(screen.queryByRole("region", { name: "Участники чата" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Подробнее" }));
    expect(screen.getByRole("region", { name: "Участники чата" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "← Вернуться к сообщениям" }));
    expect(screen.queryByText("Участники", { exact: true })).not.toBeInTheDocument();
  });

  it("offers a retry when participants fail to load", async () => {
    apiMocks.getChatMembers.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([
      { id: "user-1", username: "tester", role: "owner" },
    ]);
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    const members = within(screen.getByRole("region", { name: "Участники чата" }));
    expect(await members.findByRole("alert")).toHaveTextContent("Не удалось загрузить участников");
    fireEvent.click(members.getByRole("button", { name: "Повторить" }));
    expect(await members.findByRole("button", { name: "Открыть профиль tester" })).toBeVisible();
    expect(apiMocks.getChatMembers).toHaveBeenCalledTimes(2);
  });

  it("lets the chat owner add a user to an existing group", async () => {
    apiMocks.listChats.mockResolvedValue([{ ...chat, owner_id: "user-1" }]);
    apiMocks.getChatMembers
      .mockResolvedValueOnce([{ id: "user-1", username: "tester", role: "owner" }])
      .mockResolvedValueOnce([
        { id: "user-1", username: "tester", role: "owner" },
        { id: "user-3", username: "new-user", tag: "newuser", role: "member" },
      ]);
    apiMocks.searchUsersByUsername.mockResolvedValue([
      { id: "user-3", username: "new-user", tag: "newuser" },
    ]);
    apiMocks.addUsersToChat.mockResolvedValue({ status: "success" });

    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Открыть информацию о чате" }));
    const members = within(screen.getByRole("region", { name: "Участники чата" }));
    fireEvent.change(members.getByRole("searchbox"), { target: { value: "new" } });

    const addButton = await members.findByRole("button", { name: "Добавить" });
    fireEvent.click(addButton);
    await waitFor(() => expect(apiMocks.addUsersToChat).toHaveBeenCalledWith(chat.id, ["user-3"]));
    expect(await members.findByRole("button", { name: "Открыть профиль new-user" })).toBeVisible();
    expect(apiMocks.getChatMembers).toHaveBeenCalledTimes(2);
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
});
