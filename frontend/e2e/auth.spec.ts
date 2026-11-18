import { test, expect, user } from "./support";

test("home registration action opens the registration form", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#home-title")).toBeVisible();
  await page.locator(".home__actions .home__btn--primary").click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("heading", { name: "Создать аккаунт Spark" })).toBeVisible();
});

test("unauthenticated users are redirected from chats to login", async ({ page }) => {
  await page.goto("/chats");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Электронная почта")).toBeVisible();
});

test("registration validates locally, then asks the user to verify their email", async ({ page, mockApi }) => {
  await page.goto("/register");
  await page.getByLabel("Имя пользователя").fill("ab");
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await expect(page.locator(".register-card__error")).toBeVisible();
  expect(mockApi.requests.filter((request) => request.path === "/auth/register")).toHaveLength(0);

  await page.getByLabel("Имя пользователя").fill(user.username);
  await page.getByLabel("Уникальный тег").fill(user.tag);
  await page.getByLabel("Электронная почта").fill(user.email);
  await page.getByLabel(/^Пароль \*/).fill("ValidPassword123");
  await page.getByLabel("Пароль ещё раз").fill("ValidPassword123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Проверьте почту");
  await expect(page.getByRole("status")).toContainText(user.email);
  expect(mockApi.requests.find((request) => request.path === "/auth/register")?.body).toMatchObject({ username: user.username, email: user.email, tag: user.tag });
  expect(await page.evaluate(() => localStorage.getItem("access_token"))).toBeNull();
});

test("email login submits OAuth credentials and logout clears the session", async ({ page, mockApi }) => {
  await page.goto("/login");
  await page.getByLabel("Электронная почта").fill(user.email);
  await page.getByLabel("Пароль").fill("ValidPassword123");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/chats$/);
  await expect(page.locator(".header-user")).toHaveText(`@${user.username}`);
  await expect(page.locator(".chat-item__title")).toHaveText(mockApi.chats.map((chat) => chat.title));
  const login = mockApi.requests.find((request) => request.path === "/auth/login");
  expect(Object.fromEntries(new URLSearchParams(String(login?.body)))).toMatchObject({ username: user.email, password: "ValidPassword123" });
  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => [localStorage.getItem("access_token"), localStorage.getItem("user")])).toEqual([null, null]);
});
