import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = externalBaseURL || "http://127.0.0.1:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: externalBaseURL ? undefined : {
    command: "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VITE_API_URL: "/api/v1",
      VITE_CALLS_WS_URL: "/v1/calls/ws",
    },
  },
});
