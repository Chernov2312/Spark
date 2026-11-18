import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PollCard from "./PollCard.jsx";
import { deferred, makePoll } from "../test/fixtures";

const mocks = vi.hoisted(() => ({ getPoll: vi.fn(), vote: vi.fn(), retractVote: vi.fn(), createPoll: vi.fn() }));
vi.mock("../api", async () => ({ polls: mocks, translateApiError: (await import("../api/translations")).translateApiError }));

const poll = makePoll();

function renderWithMenu(onCloseMenu = vi.fn()) {
  const { container } = render(<div role="dialog" aria-label="Действия с сообщением" />);
  return render(<PollCard pollId={poll.id} menuTarget={container.firstElementChild} onCloseMenu={onCloseMenu} />);
}

describe("PollCard", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getPoll.mockResolvedValue(poll);
  });

  it("does not submit a second answer while the first request is pending", async () => {
    const response = deferred<ReturnType<typeof makePoll>>();
    mocks.vote.mockReturnValue(response.promise);
    render(<PollCard pollId={poll.id} />);
    const first = await screen.findByRole("button", { name: /Первый/ });
    const second = screen.getByRole("button", { name: /Второй/ });
    fireEvent.click(first);
    expect(first).toBeDisabled();
    expect(second).toBeDisabled();
    fireEvent.click(second);
    expect(mocks.vote).toHaveBeenCalledExactlyOnceWith(poll.id, "option-1");
    await act(async () => response.resolve(makePoll({ version: 2, total_votes: 1, my_option_id: "option-1" })));
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toBeEnabled();
  });

  it("confirms a correct quiz answer with a text status", async () => {
    mocks.getPoll.mockResolvedValue(makePoll({ is_quiz: true }));
    mocks.vote.mockResolvedValue(makePoll({ is_quiz: true, version: 2, total_votes: 1, my_option_id: "option-2", correct_option_id: "option-2" }));
    render(<PollCard pollId={poll.id} />);
    fireEvent.click(await screen.findByRole("button", { name: /Второй/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Верно! Вы выбрали правильный ответ.");
    expect(screen.queryByText("Неправильный ответ")).not.toBeInTheDocument();
  });

  it("keeps a vote when the server rejects retraction", async () => {
    mocks.getPoll.mockResolvedValue(makePoll({ my_option_id: "option-1", total_votes: 1 }));
    mocks.retractVote.mockRejectedValue({ response: { status: 409, data: { detail: "This poll does not allow changing or retracting an answer" } } });
    renderWithMenu();
    fireEvent.click(await screen.findByRole("button", { name: "Отменить голос" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("В этом опросе нельзя изменить или отменить ответ");
    expect(screen.getByRole("button", { name: /Первый/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("retries a failed initial load without requiring a page reload", async () => {
    mocks.getPoll.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(poll);
    render(<PollCard pollId={poll.id} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить опрос");
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(await screen.findByRole("button", { name: /Первый/ })).toBeEnabled();
    expect(mocks.getPoll).toHaveBeenCalledTimes(2);
  });

  it("votes in an anonymous poll and retracts the answer", async () => {
    mocks.vote.mockResolvedValue({ ...poll, version: 2, total_votes: 1, my_option_id: "option-1", options: [{ ...poll.options[0], votes_count: 1 }, poll.options[1]] });
    mocks.retractVote.mockResolvedValue({ ...poll, version: 3 });
    const onCloseMenu = vi.fn();
    renderWithMenu(onCloseMenu);
    fireEvent.click(await screen.findByRole("button", { name: /Первый/ }));
    const retract = await within(screen.getByRole("dialog")).findByRole("button", { name: "Отменить голос" });
    expect(retract).toBeVisible();
    expect(within(screen.getByRole("region", { name: "Опрос" })).queryByRole("button", { name: "Отменить голос" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Первый/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("1 голос")).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    fireEvent.click(retract);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Отменить голос" })).not.toBeInTheDocument());
    expect(onCloseMenu).toHaveBeenCalledOnce();
    expect(mocks.vote).toHaveBeenCalledWith(poll.id, "option-1");
    expect(mocks.retractVote).toHaveBeenCalledWith(poll.id);
    expect(screen.getByText("0 голосов")).toBeVisible();
  });

  it("reveals a quiz answer only after voting and locks irreversible answers", async () => {
    mocks.getPoll.mockResolvedValue({ ...poll, is_quiz: true, allow_retract: false });
    mocks.vote.mockResolvedValue({ ...poll, is_quiz: true, allow_retract: false, version: 2, total_votes: 1, my_option_id: "option-1", correct_option_id: "option-2", options: [{ ...poll.options[0], votes_count: 1 }, poll.options[1]] });
    renderWithMenu();
    const wrong = await screen.findByRole("button", { name: /Первый/ });
    expect(screen.queryByText("Правильный ответ")).not.toBeInTheDocument();
    fireEvent.click(wrong);
    expect(await screen.findByText("Правильный ответ")).toBeVisible();
    expect(wrong).toHaveClass("is-wrong");
    expect(wrong).toBeDisabled();
    expect(screen.getByRole("button", { name: /Второй/ })).toHaveClass("is-correct");
    expect(screen.getByRole("button", { name: /Второй/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Неверно");
    expect(screen.queryByRole("button", { name: "Отменить голос" })).not.toBeInTheDocument();
  });

  it("keeps retraction out of the card until a menu is opened", async () => {
    mocks.getPoll.mockResolvedValue(makePoll({ my_option_id: "option-1", total_votes: 1 }));
    render(<PollCard pollId={poll.id} />);
    await screen.findByText("1 голос");
    expect(screen.queryByRole("button", { name: "Отменить голос" })).not.toBeInTheDocument();
  });

  it("hides retraction before voting and prevents duplicate retractions while pending", async () => {
    const pending = deferred<ReturnType<typeof makePoll>>();
    mocks.retractVote.mockReturnValue(pending.promise);
    mocks.vote.mockResolvedValue(makePoll({ version: 2, my_option_id: "option-1", total_votes: 1 }));
    renderWithMenu();
    const first = await screen.findByRole("button", { name: /Первый/ });
    expect(screen.queryByRole("button", { name: "Отменить голос" })).not.toBeInTheDocument();
    fireEvent.click(first);
    const retract = await screen.findByRole("button", { name: "Отменить голос" });
    fireEvent.click(retract);
    expect(retract).toBeDisabled();
    expect(first).toBeDisabled();
    fireEvent.click(retract);
    expect(mocks.retractVote).toHaveBeenCalledExactlyOnceWith(poll.id);
    await act(async () => pending.resolve(makePoll({ version: 3 })));
    expect(screen.queryByRole("button", { name: "Отменить голос" })).not.toBeInTheDocument();
    expect(first).toBeEnabled();
  });

  it("shows names for each choice in an open poll", async () => {
    mocks.getPoll.mockResolvedValue({ ...poll, is_anonymous: false, total_votes: 1, options: [{ ...poll.options[0], votes_count: 1, voters: [{ id: "user-1", username: "Анна", tag: "anna" }] }, { ...poll.options[1], voters: [] }] });
    render(<PollCard pollId={poll.id} />);
    const voters = await screen.findByRole("list", { name: "Проголосовали за Первый" });
    expect(within(voters).getByText("@anna")).toBeVisible();
    expect(screen.getByText("Открыто")).toBeVisible();
  });

  it("ignores a late initial request after a newer poll update", async () => {
    let resolveInitial!: (value: typeof poll) => void;
    mocks.getPoll.mockImplementationOnce(() => new Promise((resolve) => { resolveInitial = resolve; }));
    const { rerender } = render(<PollCard pollId={poll.id} />);
    await waitFor(() => expect(mocks.getPoll).toHaveBeenCalledTimes(1));
    mocks.getPoll.mockResolvedValue({ ...poll, version: 2, total_votes: 3, options: [{ ...poll.options[0], votes_count: 3 }, poll.options[1]] });
    rerender(<PollCard pollId={poll.id} version={2} />);
    expect(await screen.findByText("3 голоса")).toBeVisible();
    await act(async () => resolveInitial(poll));
    expect(screen.getByText("3 голоса")).toBeVisible();
  });

  it("keeps the previous answer when a vote request fails", async () => {
    mocks.getPoll.mockResolvedValue({ ...poll, total_votes: 1, my_option_id: "option-1" });
    mocks.vote.mockRejectedValue(new Error("offline"));
    render(<PollCard pollId={poll.id} />);
    fireEvent.click(await screen.findByRole("button", { name: /Второй/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить ответ");
    expect(screen.getByRole("button", { name: /Первый/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Второй/ })).not.toBeDisabled();
  });
});
