import { expect, test } from "@playwright/test";

const user = {
  id: "c4e833e0-0cf3-4b83-a1e5-56b8874e3e93",
  username: "spark-e2e",
  email: "spark-e2e@example.com",
  access_token: "playwright-test-token",
  token_type: "bearer",
};

test("home page registration action opens the registration form", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.locator("#home-title")).toBeVisible();
  await page.locator(".home__actions .home__btn--primary").click();

  await expect(page).toHaveURL(/\/register$/);
  await expect(page.locator("form.register-card")).toBeVisible();
});

test("unauthenticated users are redirected from chats to login", async ({
  page,
}) => {
  await page.goto("/chats");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("form.register-card")).toBeVisible();
});

test("registration validation blocks incomplete data before calling the API", async ({
  page,
}) => {
  let registrationRequests = 0;
  await page.route("**/api/v1/auth/register", async (route) => {
    registrationRequests += 1;
    await route.fulfill({ status: 201, json: user });
  });

  await page.goto("/register");
  await page.locator('input[autocomplete="username"]').fill("ab");
  await page
    .locator('form.register-card button[type="submit"]')
    .click();

  await expect(page.locator(".register-card__error")).toBeVisible();
  expect(registrationRequests).toBe(0);
});

test("login opens the chat list and logout returns to login", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({ status: 200, json: user });
  });
  await page.route("**/api/v1/chats", async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        chats: [
          {
            id: "6b833462-969f-4a48-bdfc-4147f83be3a8",
            title: "Playwright chat",
            description: "Browser test chat",
            owner_id: user.id,
            avatar_urls: [],
            created_at: "2026-01-01T12:00:00Z",
          },
        ],
      },
    });
  });

  await page.goto("/login");
  await page.locator('input[autocomplete="username"]').fill(user.username);
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("ValidPassword123");
  await page.locator('form.register-card button[type="submit"]').click();

  await expect(page).toHaveURL(/\/chats$/);
  await expect(page.locator(".header-user")).toHaveText(`@${user.username}`);
  await expect(page.locator(".chat-item__title")).toHaveText(
    "Playwright chat",
  );
  await expect(page).toHaveURL(/\/chats$/);

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
