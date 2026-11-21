import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const worker = readFileSync(resolve("public", "push-sw.js"), "utf8");

describe("Web Push service worker", () => {
  it("shows a silent notification and opens its chat when clicked", async () => {
    const events = new Map<string, (event: Record<string, unknown>) => void>();
    const showNotification = vi.fn(async () => {});
    const openWindow = vi.fn(async () => {});
    const close = vi.fn();
    const waitUntil = vi.fn();
    runInNewContext(worker, {
      URL,
      self: {
        location: { origin: "https://spark.example" },
        addEventListener: events.set.bind(events),
        registration: { showNotification },
        clients: { openWindow, matchAll: async () => [] },
      },
    });
    const chatId = "12345678-1234-1234-1234-123456789abc";
    events.get("push")!({ data: { json: () => ({ chat_id: chatId, silent: true }) }, waitUntil });
    await waitUntil.mock.lastCall![0];
    expect(showNotification).toHaveBeenCalledWith("Spark", expect.objectContaining({ silent: true, data: { chatId } }));

    events.get("notificationclick")!({ notification: { data: { chatId }, close }, waitUntil });
    await waitUntil.mock.lastCall![0];
    expect(close).toHaveBeenCalledOnce();
    expect(openWindow).toHaveBeenCalledWith(`https://spark.example/chats/${chatId}`);
  });
});
