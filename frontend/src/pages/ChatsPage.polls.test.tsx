import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { apiMocks, audioMessage, chat, renderChat, socketState, setupChatTests } from "../test/chatHarness";
import { makeMessage, makePoll } from "../test/fixtures";

setupChatTests();

describe("ChatsPage: polls", () => {
  it("retracts only the poll whose message menu was opened and keeps other message actions", async () => {
    const first = makePoll({ id: "poll-1", question: "Первый опрос", my_option_id: "option-1", total_votes: 1 });
    const second = makePoll({ id: "poll-2", question: "Второй опрос", my_option_id: "option-2", total_votes: 1 });
    apiMocks.listMessages.mockResolvedValue([
      makeMessage({ id: "poll-message-1", poll_id: first.id }),
      makeMessage({ id: "poll-message-2", poll_id: second.id }),
    ]);
    apiMocks.getPoll.mockImplementation(async (id) => id === first.id ? first : second);
    apiMocks.retractPollVote.mockResolvedValue({ ...second, my_option_id: null, total_votes: 0, version: 2 });
    renderChat();
    await screen.findByRole("heading", { name: first.question });
    const heading = await screen.findByRole("heading", { name: second.question });
    expect(screen.queryByRole("button", { name: "Отменить голос" })).not.toBeInTheDocument();
    fireEvent.contextMenu(heading, { clientX: 100, clientY: 120 });
    const menu = screen.getByRole("dialog", { name: "Действия с сообщением" });
    expect(within(menu).getByRole("button", { name: "Открыть тред" })).toBeVisible();
    fireEvent.click(within(menu).getByRole("button", { name: "Отменить голос" }));
    await waitFor(() => expect(apiMocks.retractPollVote).toHaveBeenCalledExactlyOnceWith(second.id));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const secondCard = heading.closest("section")!;
    await waitFor(() => expect(secondCard).toHaveTextContent("0 голосов"));
    const firstCard = screen.getByRole("heading", { name: first.question }).closest("section")!;
    expect(within(firstCard).getByRole("button", { name: /Первый/ })).toHaveAttribute("aria-pressed", "true");
    expect(apiMocks.getPoll).toHaveBeenCalledTimes(2);
    fireEvent.click(within(document.getElementById("message-poll-message-2")!).getByRole("button", { name: "Действия с сообщением" }));
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Отменить голос" })).not.toBeInTheDocument();
  });

  it("creates an anonymous poll from the composer and renders it as a message", async () => {
    const pollMessage = { ...audioMessage, id: "poll-message", attachments: [], text: "Когда встречаемся?", poll_id: "poll-1" };
    apiMocks.createPoll.mockResolvedValue(pollMessage);
    apiMocks.getPoll.mockResolvedValue({
      id: "poll-1", question: pollMessage.text, version: 1, is_anonymous: true,
      allow_retract: true, is_quiz: false, is_creator: true, total_votes: 0, my_option_id: null, correct_option_id: null,
      options: [{ id: "option-1", text: "Утром", votes_count: 0, voters: null }, { id: "option-2", text: "Вечером", votes_count: 0, voters: null }],
    });
    renderChat();
    fireEvent.click(await screen.findByRole("button", { name: "Создать опрос" }));
    const dialog = screen.getByRole("dialog", { name: "Новый опрос" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Вопрос" }), { target: { value: pollMessage.text } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Вариант 1" }), { target: { value: "Утром" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Вариант 2" }), { target: { value: "Вечером" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Создать опрос" }));
    expect(await screen.findByRole("heading", { name: pollMessage.text })).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apiMocks.createPoll).toHaveBeenCalledWith(chat.id, expect.objectContaining({ is_anonymous: true, allow_retract: true, options: ["Утром", "Вечером"] }));
    fireEvent.click(within(document.getElementById("message-poll-message")!).getByRole("button", { name: "Действия с сообщением" }));
    const actions = screen.getByRole("dialog", { name: "Действия с сообщением" });
    expect(within(actions).queryByRole("button", { name: "Изменить" })).not.toBeInTheDocument();
    expect(within(actions).queryByRole("button", { name: "Переслать" })).not.toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "Закрепить" })).toBeVisible();
  });

  it("refreshes a poll card when a poll update arrives via websocket", async () => {
    apiMocks.listMessages.mockResolvedValue([{ ...audioMessage, attachments: [], poll_id: "poll-live" }]);
    const initial = { id: "poll-live", question: "Голосование", version: 1, is_anonymous: true, allow_retract: true, is_quiz: false, is_creator: false, total_votes: 0, my_option_id: null, correct_option_id: null, options: [{ id: "option-1", text: "Да", votes_count: 0 }, { id: "option-2", text: "Нет", votes_count: 0 }] };
    apiMocks.getPoll.mockResolvedValue(initial);
    renderChat();
    expect(await screen.findByText("0 голосов")).toBeVisible();
    apiMocks.getPoll.mockResolvedValue({ ...initial, version: 2, total_votes: 1, options: [{ ...initial.options[0], votes_count: 1 }, initial.options[1]] });
    act(() => socketState.options!.onEvent("poll:updated", { chat_id: chat.id, poll_id: initial.id, message_id: audioMessage.id, version: 2 }));
    expect(await screen.findByText("1 голос")).toBeVisible();
  });
});
