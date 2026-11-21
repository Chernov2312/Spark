import { describe, expect, it } from "vitest";
import { makeMessage } from "../test/fixtures";
import type { TestAttachment, TestMessage } from "../test/fixtures";
import { messagePreview, messageTimestamp } from "./messagePreview";

const file = (mimeType: string, name = "document.pdf"): TestAttachment => ({
  id: "file-1", file_key: "https://storage.test/file", file_name: name, mime_type: mimeType, file_size: 10,
});

describe("message previews", () => {
  it.each<[string, Partial<TestMessage>, string]>([
    ["text", { text: "  Две\nстроки   текста  " }, "Две строки текста"],
    ["spoiler", { text: "До ||секрет|| после" }, "До [Спойлер] после"],
    ["literal spoiler in inline code", { text: "Код: `||a||`" }, "Код: `||a||`"],
    ["caption before attachments", { text: "Подпись", attachments: [file("image/png")] }, "Подпись"],
    ["photo without caption", { text: null, attachments: [file("image/png")] }, "Фото"],
    ["forwarded photo", { text: null, is_forwarded: true, attachments: [file("image/png")] }, "Переслано: Фото"],
    ["video without caption", { text: null, attachments: [file("video/mp4")] }, "Видео"],
    ["voice note", { text: null, attachments: [file("audio/ogg")] }, "Голосовое сообщение"],
    ["document", { text: "  ", attachments: [file("application/pdf")] }, "document.pdf"],
    ["album", { text: null, attachments: [file("image/png"), file("image/jpeg")] }, "Вложения: 2"],
    ["thread reply", { text: "Ответ", thread_root_id: "root-1" }, "В треде: Ответ"],
    ["poll in a thread", { text: "Что выбираем?", poll_id: "poll-1", thread_root_id: "root-1" }, "В треде: Опрос: Что выбираем?"],
  ])("formats %s", (_name, message, expected) => {
    expect(messagePreview(makeMessage(message))).toBe(expected);
  });

  it("shows an empty-chat placeholder when there is no last message", () => {
    expect(messagePreview(null)).toBe("Нет сообщений");
  });
});

describe("message timestamps", () => {
  it("interprets backend timestamps without an offset as UTC", () => {
    expect(messageTimestamp("2026-01-01T12:00:00")).toBe(messageTimestamp("2026-01-01T12:00:00Z"));
    expect(messageTimestamp("2026-01-01T19:00:00+07:00")).toBe(messageTimestamp("2026-01-01T12:00:00Z"));
  });

  it.each([null, undefined, "", "not a timestamp"])("ignores missing or invalid time %s", (value) => {
    expect(messageTimestamp(value)).toBe(0);
  });
});
