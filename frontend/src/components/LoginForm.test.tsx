import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deferred } from "../test/fixtures";

import LoginForm from "./LoginForm";

const loginUser = vi.hoisted(() => vi.fn());
vi.mock("../api", async () => ({
  auth: { loginUser },
  translateApiError: (await import("../api/translations")).translateApiError,
}));

function renderLogin() {
  const onSuccess = vi.fn();
  render(<MemoryRouter><LoginForm onSuccess={onSuccess} /></MemoryRouter>);
  return onSuccess;
}

function enterCredentials(email = "user@example.com", password = "Password123") {
  fireEvent.change(screen.getByLabelText(/Электронная почта/), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/^Пароль/), { target: { value: password } });
}

describe("LoginForm", () => {
  beforeEach(() => loginUser.mockReset());

  it("submits the email in OAuth2 username and returns the server result", async () => {
    const result = { access_token: "test-token" };
    loginUser.mockResolvedValue(result);
    const onSuccess = renderLogin();
    expect(screen.getByLabelText(/Электронная почта/)).toHaveAttribute("type", "email");
    enterCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledExactlyOnceWith(result));
    expect(loginUser).toHaveBeenCalledExactlyOnceWith({ username: "user@example.com", password: "Password123" });
  });

  it.each([["", "Password123"], ["user@example.com", ""], ["", ""]])("does not submit missing credentials (%s)", (email, password) => {
    renderLogin();
    enterCredentials(email, password);
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(screen.getByText("Заполните все поля")).toBeVisible();
    expect(loginUser).not.toHaveBeenCalled();
  });

  it("disables submission while a login request is pending", async () => {
    const response = deferred<{ access_token: string }>();
    loginUser.mockReturnValue(response.promise);
    const onSuccess = renderLogin();
    enterCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    const pending = screen.getByRole("button", { name: "Вход…" });
    expect(pending).toBeDisabled();
    fireEvent.click(pending);
    expect(loginUser).toHaveBeenCalledTimes(1);
    await act(async () => response.resolve({ access_token: "token" }));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("shows a translated server error and allows a corrected retry", async () => {
    loginUser.mockRejectedValueOnce({ response: { status: 401, data: { detail: "Incorrect email or password" } } }).mockResolvedValueOnce({ access_token: "token" });
    const onSuccess = renderLogin();
    enterCredentials();
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    expect(await screen.findByText("Неверный email или пароль")).toBeVisible();
    expect(onSuccess).not.toHaveBeenCalled();
    enterCredentials("other@example.com", "CorrectPassword123");
    fireEvent.click(screen.getByRole("button", { name: "Войти" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(loginUser).toHaveBeenLastCalledWith({ username: "other@example.com", password: "CorrectPassword123" });
    expect(screen.queryByText("Неверный email или пароль")).not.toBeInTheDocument();
  });
});
