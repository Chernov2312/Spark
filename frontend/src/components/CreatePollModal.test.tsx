import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CreatePollModal from "./CreatePollModal.jsx";
import { deferred } from "../test/fixtures";

const mocks = vi.hoisted(() => ({ getPoll: vi.fn(), vote: vi.fn(), retractVote: vi.fn(), createPoll: vi.fn() }));
vi.mock("../api", async () => ({ polls: mocks, translateApiError: (await import("../api/translations")).translateApiError }));
describe("CreatePollModal", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it.each([
    ["", "Первый", "Второй", "Заполните вопрос"],
    ["Вопрос", "  ", "Второй", "Заполните вопрос"],
    ["Вопрос", "Первый", " первый ", "Варианты ответа не должны повторяться"],
  ])("rejects incomplete or duplicate answers before requesting the API", (question, first, second, error) => {
    render(<CreatePollModal chatId="chat-1" threadRootId={null} onCreated={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Вопрос" }), { target: { value: question } });
    fireEvent.change(screen.getByRole("textbox", { name: "Вариант 1" }), { target: { value: first } });
    fireEvent.change(screen.getByRole("textbox", { name: "Вариант 2" }), { target: { value: second } });
    fireEvent.click(screen.getByRole("button", { name: "Создать опрос" }));
    expect(screen.getByRole("alert")).toHaveTextContent(error);
    expect(mocks.createPoll).not.toHaveBeenCalled();
  });

  it("enforces the two-to-ten option limits", () => {
    render(<CreatePollModal chatId="chat-1" threadRootId={null} onCreated={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Убрать вариант 1" })).toBeDisabled();
    const add = screen.getByRole("button", { name: "＋ Добавить вариант" });
    for (let index = 0; index < 8; index += 1) fireEvent.click(add);
    expect(screen.getAllByRole("textbox")).toHaveLength(11);
    expect(add).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Убрать вариант 10" }));
    expect(add).toBeEnabled();
    expect(screen.getAllByRole("textbox")).toHaveLength(10);
  });

  it("disables duplicate submissions until creation completes", async () => {
    const response = deferred<{ id: string; poll_id: string }>();
    mocks.createPoll.mockReturnValue(response.promise);
    const onCreated = vi.fn();
    render(<CreatePollModal chatId="chat-1" threadRootId={null} onCreated={onCreated} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Вопрос" }), { target: { value: "Вопрос" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Вариант 1" }), { target: { value: "A" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Вариант 2" }), { target: { value: "B" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать опрос" }));
    const pending = screen.getByRole("button", { name: "Создание…" });
    expect(pending).toBeDisabled();
    expect(screen.getByRole("button", { name: "Закрыть создание опроса" })).toBeDisabled();
    fireEvent.click(pending);
    expect(mocks.createPoll).toHaveBeenCalledTimes(1);
    await act(async () => response.resolve({ id: "message-1", poll_id: "poll-1" }));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("creates a public irreversible quiz and preserves the correct choice after removing an option", async () => {
    const onCreated = vi.fn();
    const message = { id: "new-message", poll_id: "new-poll" };
    mocks.createPoll.mockResolvedValue(message);
    render(<CreatePollModal chatId="chat-1" threadRootId="thread-1" onCreated={onCreated} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Викторина" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Вопрос" }), { target: { value: "Правильный вариант?" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Вариант 1" }), { target: { value: "Первый" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Вариант 2" }), { target: { value: "Второй" } });
    fireEvent.click(screen.getByRole("button", { name: "＋ Добавить вариант" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Вариант 3" }), { target: { value: "Третий" } });
    fireEvent.click(screen.getByRole("radio", { name: "Правильный ответ: вариант 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Убрать вариант 1" }));
    fireEvent.click(screen.getByRole("switch", { name: "Анонимное голосование" }));
    fireEvent.click(screen.getByRole("switch", { name: "Разрешить отмену ответа" }));
    fireEvent.click(screen.getByRole("button", { name: "Создать викторину" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(message));
    expect(mocks.createPoll).toHaveBeenCalledWith("chat-1", {
      question: "Правильный вариант?", options: ["Второй", "Третий"],
      is_anonymous: false, allow_retract: false, is_quiz: true,
      correct_option_index: 0, thread_root_id: "thread-1",
    });
  });

  it("validates the correct quiz answer before sending a request", async () => {
    render(<CreatePollModal chatId="chat-1" threadRootId={null} onCreated={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Вопрос" }), { target: { value: "Вопрос" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Вариант 1" }), { target: { value: "Первый" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Вариант 2" }), { target: { value: "Второй" } });
    fireEvent.click(screen.getByRole("button", { name: "Викторина" }));
    fireEvent.click(screen.getByRole("button", { name: "Создать викторину" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Отметьте правильный ответ");
    expect(mocks.createPoll).not.toHaveBeenCalled();
  });
});
