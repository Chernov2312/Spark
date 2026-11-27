import { beforeEach, describe, expect, it, vi } from "vitest";
import { forwardMessage, sendMessage, updateMessage } from "./messages";

const { post, put } = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
vi.mock("./client", () => ({ api: { post, put } }));

describe("message link previews in API requests", () => {
  beforeEach(() => {
    post.mockResolvedValue({ data: {} });
    put.mockResolvedValue({ data: {} });
  });

  it("sends the first rendered web link and preserves the original message text", async () => {
    const text = "\x60https://example.com/code\x60 [Сайт](https://example.com/?a=1&b=2) https://example.org";
    await sendMessage("chat", { text, reply_to_id: "original" });
    expect(post).toHaveBeenCalledWith("/chats/chat/messages", {
      text, reply_to_id: "original", link_preview_url: "https://example.com/?a=1&b=2",
    });
  });

  it("sends no preview URL for code blocks or other contacts after an edit", async () => {
    const text = "\x60\x60\x60\nhttps://example.com/code\n\x60\x60\x60\nmail@example.org +7 999 123-45-67";
    await updateMessage("message", text);
    expect(put).toHaveBeenCalledWith("/messages/message", { text, link_preview_url: null });
  });

  it("skips concealed links when choosing a card to request", async () => {
    const text = "||https://example.org/hidden|| https://example.com/visible";
    await sendMessage("chat", { text });
    expect(post).toHaveBeenCalledWith("/chats/chat/messages", {
      text, link_preview_url: "https://example.com/visible",
    });
  });

  it.each([null, "Копия для https://example.com"])("sends caption %j and selects the preview from the source text", async (caption) => {
    const args = ["chat", "message", "target", "Сайт: www.example.org."] as const;
    if (caption === null) await forwardMessage(...args);
    else await forwardMessage(...args, caption);
    expect(post).toHaveBeenCalledWith("/chats/chat/messages/message/forward", {
      target_chat_id: "target", caption, link_preview_url: "https://www.example.org",
    });
  });
});
