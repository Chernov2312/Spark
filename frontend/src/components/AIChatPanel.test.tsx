import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AIChatPanel from "./AIChatPanel";

const { aiMocks } = vi.hoisted(() => ({
  aiMocks: {
    summarizeChat: vi.fn(),
    askChatAssistant: vi.fn(),
  },
}));

vi.mock("../api/ai", () => aiMocks);

describe("AIChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiMocks.summarizeChat.mockResolvedValue({ summary: "Короткая сводка." });
    aiMocks.askChatAssistant.mockResolvedValue({ answer: "Ответ по чату." });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
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
