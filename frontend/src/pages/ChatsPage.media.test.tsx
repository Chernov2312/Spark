import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { apiMocks, audioMessage, chat, renderChat, socketState, setupChatTests } from "../test/chatHarness";

setupChatTests();

describe("ChatsPage: media", () => {
  it("renders Markdown document structures and ignores raw HTML and unsafe links", async () => {
    await import("../components/MarkdownAttachmentPreview");
    const text = [
      "Релиз", "=====", "",
      "1. Пункт", "   - Вложенный пункт", "",
      "| Версия | Статус |", "| --- | --- |", "| 1.0 | Готово |", "",
      "- [x] Проверено", "",
      "> Цитата", "",
      "~~~js", "console.log('<tag>')", "~~~", "",
      "[Сайт](https://example.com) [Запрещённая схема](javascript:alert%281%29)", "",
      "<script>bad()</script>",
    ].join("\n");
    apiMocks.listMessages.mockResolvedValue([{
      ...audioMessage,
      attachments: [{
        ...audioMessage.attachments[0],
        mime_type: "application/octet-stream", file_name: "notes.MARKDOWN", text,
      }],
    }]);
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Просмотреть Markdown" }));
    const preview = await screen.findByRole("region", { name: "Предпросмотр notes.MARKDOWN" });
    expect(within(preview).getByRole("heading", { name: "Релиз", level: 1 })).toBeVisible();
    expect(preview.querySelector("ol li ul")).toHaveTextContent("Вложенный пункт");
    expect(within(preview).getByRole("table")).toHaveTextContent("Готово");
    expect(within(preview).getByRole("checkbox")).toBeChecked();
    expect(within(preview).getByRole("checkbox")).toBeDisabled();
    expect(preview.querySelector("blockquote")).toHaveTextContent("Цитата");
    expect(preview.querySelector("pre code")).toHaveTextContent("console.log('<tag>')");
    expect(within(preview).getByRole("link", { name: "Сайт" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(preview).queryByRole("link", { name: "Запрещённая схема" })).not.toBeInTheDocument();
    expect(preview).not.toHaveTextContent("bad()");
    expect(apiMocks.getAttachmentDownloadUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Скрыть Markdown" }));
    expect(preview).not.toBeInTheDocument();
  });

  it("fetches an older Markdown attachment and can retry a failed request", async () => {
    apiMocks.listMessages.mockResolvedValue([{
      ...audioMessage,
      attachments: [{
        ...audioMessage.attachments[0],
        mime_type: "text/markdown; charset=utf-8", file_name: "legacy", text: null,
      }],
    }]);
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValueOnce(new Response("# Восстановленный документ"));
    vi.stubGlobal("fetch", fetch);
    renderChat();
    const toggle = await screen.findByRole("button", { name: "Просмотреть Markdown" });
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(toggle);
    expect(await screen.findByText("Не удалось загрузить Markdown.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByRole("heading", { name: "Восстановленный документ" })).toBeVisible();
    expect(apiMocks.getAttachmentDownloadUrl).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenLastCalledWith(
      "https://storage.test/download/audio.ogg",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("shows a local image preview and removes it from the composer", async () => {
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });

    fireEvent.click(screen.getByRole("button", { name: "Дополнительные действия" }));
    const file = new File(["image-bytes"], "photo.png", { type: "image/png" });
    const input = document.querySelector(
      ".chat-view__composer input[type='file']",
    );
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });

    const preview = await screen.findByRole("img", { name: "photo.png" });
    expect(preview).toHaveAttribute("src", expect.stringMatching(/^blob:/));
    fireEvent.click(document.querySelector(".composer-attachments__remove")!);
    await waitFor(() => {
      expect(screen.queryByRole("img", { name: "photo.png" })).not.toBeInTheDocument();
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

    act(() => socketState.options!.onEvent("attachment:text", {
      chat_id: chat.id,
      message_id: audioMessage.id,
      attachment_id: audioMessage.attachments[0].id,
      text: "Привет, это распознанный текст.",
      error: false,
    }));
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
    fireEvent.click(screen.getByRole("button", { name: "Дополнительные действия" }));
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
    vi.spyOn(navigator, "mediaDevices", "get").mockReturnValue({ getUserMedia: vi.fn().mockResolvedValue(stream) } as unknown as MediaDevices);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    renderChat();
    await screen.findByText(chat.title, { selector: ".chat-view__title" });

    expect(screen.getByRole("button", { name: "Записать голосовое сообщение" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Дополнительные действия" }));
    expect(screen.getByRole("menuitem", { name: "Прикрепить файл" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Записать голосовое" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Опрос или викторина" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

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
