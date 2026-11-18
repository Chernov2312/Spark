import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AIChatPanel from "./AIChatPanel";
import { deferred } from "../test/fixtures";

const { aiMocks } = vi.hoisted(() => ({
  aiMocks: {
    summarizeChat: vi.fn(),
    askChatAssistant: vi.fn(),
    askSystemAssistant: vi.fn(),
  },
}));

vi.mock("../api/ai", () => aiMocks);

describe("AIChatPanel", () => {
  it("uses the system assistant without sending a chat context", async () => {
    render(<AIChatPanel chatId="chat-8" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "Системный помощник" }));
    expect(screen.queryByLabelText("Сообщений в контексте")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Вопрос системному помощнику"), { target: { value: "  Как это работает?  " } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Системный ответ.")).toBeVisible();
    expect(aiMocks.askSystemAssistant).toHaveBeenCalledExactlyOnceWith("Как это работает?");
    expect(aiMocks.askChatAssistant).not.toHaveBeenCalled();
    expect(aiMocks.summarizeChat).not.toHaveBeenCalled();
  });

  it("keeps the question and shows a server error when a request fails", async () => {
    aiMocks.askChatAssistant.mockRejectedValue({ response: { data: { detail: "Модель временно недоступна" } } });
    render(<AIChatPanel chatId="chat-8" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Вопрос ИИ-помощнику"), { target: { value: "Что решили?" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Модель временно недоступна");
    expect(screen.getByLabelText("Вопрос ИИ-помощнику")).toHaveValue("Что решили?");
    expect(screen.getByRole("button", { name: "Отправить" })).toBeEnabled();
  });

  it("prevents another request or mode change while waiting for an answer", async () => {
    const response = deferred<{ answer: string }>();
    aiMocks.askChatAssistant.mockReturnValue(response.promise);
    render(<AIChatPanel chatId="chat-8" onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Вопрос ИИ-помощнику"), { target: { value: "Вопрос" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(screen.getByRole("button", { name: "Отправить" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Системный помощник" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Сделать сводку" })).toBeDisabled();
    await act(async () => response.resolve({ answer: "Готово" }));
    expect(screen.getByText("Готово")).toBeVisible();
    expect(aiMocks.askChatAssistant).toHaveBeenCalledTimes(1);
  });

  it("blocks whitespace-only questions and calls the close action", () => {
    const onClose = vi.fn();
    render(<AIChatPanel chatId="chat-8" onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Вопрос ИИ-помощнику"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Отправить" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть помощника" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(aiMocks.askChatAssistant).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    for (const mock of Object.values(aiMocks)) mock.mockReset();
    aiMocks.summarizeChat.mockResolvedValue({ summary: "Короткая сводка." });
    aiMocks.askChatAssistant.mockResolvedValue({ answer: "Ответ по чату." });
    aiMocks.askSystemAssistant.mockResolvedValue({ answer: "Системный ответ." });
  });

  it("requests and displays a summary for the selected number of messages", async () => {
    render(<AIChatPanel chatId="chat-7" onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Сообщений в контексте"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сделать сводку" }));

    expect(await screen.findByText("Короткая сводка.")).toBeInTheDocument();
    expect(aiMocks.summarizeChat).toHaveBeenCalledWith("chat-7", 10);
  });

  it("sends a question with the selected context size and shows the reply", async () => {
    render(<AIChatPanel chatId="chat-8" onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Вопрос ИИ-помощнику"), {
      target: { value: "Какие задачи договорились сделать?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(await screen.findByText("Ответ по чату.")).toBeInTheDocument();
    expect(aiMocks.askChatAssistant).toHaveBeenCalledWith(
      "chat-8",
      "Какие задачи договорились сделать?",
      30,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Вопрос ИИ-помощнику")).toHaveValue(""),
    );
  });
});
