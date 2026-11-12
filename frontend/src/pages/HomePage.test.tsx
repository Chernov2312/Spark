import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import HomePage from "./HomePage.jsx";

function renderHomePage() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe("HomePage", () => {
  it("introduces Spark with a clear heading and registration action", () => {
    renderHomePage();

    expect(
      screen.getByRole("heading", { name: "Будь на связи своим кругом" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Создать аккаунт/ }),
    ).toHaveAttribute("href", "/register");
  });

  it("shows a preview of a conversation", () => {
    renderHomePage();

    const preview = screen.getByRole("region", { name: "Возможности Spark" });
    expect(within(preview).getByText("Увидимся сегодня? ✨")).toBeInTheDocument();
    expect(within(preview).getByText("Конечно! Уже выхожу")).toBeInTheDocument();
  });

  it("lists the main product benefits", () => {
    renderHomePage();

    const benefits = screen.getByRole("region", { name: "Преимущества" });
    expect(within(benefits).getAllByRole("heading", { level: 2 })).toHaveLength(3);
    expect(within(benefits).getByText("Быстро и просто")).toBeInTheDocument();
    expect(within(benefits).getByText("Всегда под рукой")).toBeInTheDocument();
  });
});
