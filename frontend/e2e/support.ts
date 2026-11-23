import { test as base, expect, type Page, type WebSocketRoute } from "@playwright/test";
import { makeChat, makeMessage, makePoll, type TestAttachment, type TestMessage, type TestPoll } from "../src/test/fixtures";

export { expect };

export const user = {
  id: "c4e833e0-0cf3-4b83-a1e5-56b8874e3e93",
  username: "spark-e2e", tag: "spark_e2e", email: "spark-e2e@example.com",
  access_token: "playwright-test-token", token_type: "bearer",
};
export const chats = [
  makeChat({ id: "6b833462-969f-4a48-bdfc-4147f83be3a8", title: "Первый чат", owner_id: user.id }),
  makeChat({ id: "77ad93de-3ea3-4dbe-b102-52ab42bf77aa", title: "Второй чат", owner_id: user.id }),
];
export const chatId = chats[0].id;

type RecordedRequest = { method: string; path: string; body: unknown; authorization?: string };
type Upload = { key: string; body: Buffer; contentType: string };
type PollInput = {
  question: string; options: string[]; is_anonymous: boolean; allow_retract: boolean;
  is_quiz: boolean; correct_option_index: number | null; thread_root_id: string | null;
};

/** Stateful API boundary. Unhandled requests fail the test instead of reaching a real backend. */
export class MockApi {
  readonly chats = structuredClone(chats);
  readonly messages = new Map<string, TestMessage[]>();
  readonly pins = new Map<string, TestMessage[]>();
  readonly polls = new Map<string, TestPoll>();
  readonly requests: RecordedRequest[] = [];
  readonly unexpected: string[] = [];
  readonly tempUrlRequests: Array<Record<string, string>> = [];
  readonly uploads: Upload[] = [];
  private readonly sockets = new Map<string, WebSocketRoute>();
  private readonly correctOptions = new Map<string, string>();
  private readonly media = new Map<string, Upload>();
  private sequence = 0;

  constructor(private readonly page: Page) {}

  async install() {
    // Hold mocked sockets open; closing before the handshake causes browser errors.
    await this.page.routeWebSocket(/.*/, (socket) => {
      const match = new URL(socket.url()).pathname.match(/\/([^/]+)\/ws$/);
      if (match) this.sockets.set(match[1], socket);
    });
    await this.page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace("/api/v1", "");
      const method = request.method();
      const body: unknown = request.postData()
        ? request.headers()["content-type"]?.includes("application/json")
          ? request.postDataJSON() : request.postData()
        : null;
      this.requests.push({ method, path, body, authorization: request.headers().authorization });
      const respond = (json: unknown, status = 200) => route.fulfill({ status, json });
      if (method === "POST" && (path === "/auth/login" || path === "/auth/logout")) {
        const origin = request.headers().origin;
        const headers = origin ? {
          "access-control-allow-origin": origin,
          "access-control-allow-credentials": "true",
        } : undefined;
        if (path === "/auth/login") return route.fulfill({ status: 200, json: user, headers });
        return route.fulfill({ status: 204, headers });
      }
      if (method === "POST" && path === "/auth/register") {
        const input = body as { email: string; tag: string };
        return respond({ verification_required: true, email: input.email, tag: input.tag }, 201);
      }
      if (method === "GET" && path === "/chats") return respond({ chats: this.chats });
      if (method === "GET" && path === "/users/me") return respond({
        ...user,
        bio: null,
        birth_date: null,
        profile_visibility: { avatar: "everyone", bio: "everyone", birth_date: "everyone" },
        profile_exceptions: { avatar: [], bio: [], birth_date: [] },
      });
      if (method === "GET" && path === "/friends") return respond({ friends: [], requests: [], categories: [] });
      if (method === "GET" && path === "/chat-folders") return respond({ folders: [] });
      const chatMatch = path.match(/^\/chats\/([^/]+)\/(.+)$/);
      if (chatMatch) {
        const [, currentChat, resource] = chatMatch;
        const history = this.messages.get(currentChat) || [];
        if (method === "GET" && resource === "members") return respond([{ ...user, role: "owner", avatar_urls: [] }]);
        if (method === "GET" && resource === "threads") return respond({ messages: [] });
        if (method === "POST" && resource === "read") return respond({ last_read_message_id: (body as { message_id: string }).message_id });
        if (method === "GET" && resource === "messages/pinned") return respond({ messages: this.pins.get(currentChat) || [] });
        if (method === "GET" && resource === "messages/search") {
          const query = url.searchParams.get("text") || "";
          return respond({ messages: history.filter((message) => message.text?.includes(query)) });
        }
        if (method === "GET" && resource === "messages") return respond({ messages: history });
        if (method === "POST" && resource === "messages") {
          const input = body as Partial<TestMessage>;
          const attachments = (input.attachments || []).map((attachment) => {
            const upload = this.uploads.find((item) => item.key === attachment.file_key);
            if (upload) this.media.set(attachment.id, upload);
            return { ...attachment, file_key: `/__media/${attachment.id}` };
          });
          const message = makeMessage({ ...input, id: `sent-${++this.sequence}`, chat_id: currentChat, user_id: user.id, attachments });
          this.messages.set(currentChat, [...history, message]);
          return respond(message, 201);
        }
        if (method === "PUT" && /^messages\/[^/]+\/pin$/.test(resource)) {
          const id = resource.split("/")[1];
          const pins = this.pins.get(currentChat) || [];
          const pinned = !pins.some((message) => message.id === id);
          const message = history.find((item) => item.id === id);
          this.pins.set(currentChat, pinned && message ? [...pins, { ...message, is_pinned: true }] : pins.filter((item) => item.id !== id));
          return respond({ pinned });
        }
        if (method === "POST" && /\/transcribe$/.test(resource)) return respond({ queued: true });
        if (method === "POST" && resource === "polls") {
          const input = body as PollInput;
          const id = `poll-${++this.sequence}`;
          const message = makeMessage({ id: `poll-message-${this.sequence}`, chat_id: currentChat, user_id: user.id, text: input.question, poll_id: id, thread_root_id: input.thread_root_id });
          const poll = makePoll({
            ...input, id, message_id: message.id, chat_id: currentChat, is_creator: true,
            options: input.options.map((text, index) => ({ id: `${id}-option-${index}`, text, votes_count: 0, voters: input.is_anonymous ? null : [] })),
          });
          if (input.correct_option_index !== null) this.correctOptions.set(id, poll.options[input.correct_option_index].id);
          this.polls.set(id, poll);
          this.messages.set(currentChat, [...history, message]);
          return respond(message, 201);
        }
      }
      const pollMatch = path.match(/^\/polls\/([^/]+)(\/vote)?$/);
      if (pollMatch) {
        const [, id, voting] = pollMatch;
        const poll = this.polls.get(id);
        if (!poll) return respond({ detail: "Poll not found" }, 404);
        if (method === "GET" && !voting) return respond(poll);
        if ((method === "PUT" || method === "DELETE") && voting) {
          if (poll.my_option_id && !poll.allow_retract) return respond({ detail: "Vote cannot be changed" }, 409);
          const optionId = method === "PUT" ? (body as { option_id: string }).option_id : null;
          const previousId = poll.my_option_id;
          poll.my_option_id = optionId;
          poll.total_votes += Number(Boolean(optionId)) - Number(Boolean(previousId));
          poll.correct_option_id = optionId ? this.correctOptions.get(id) || null : null;
          poll.version += 1;
          for (const option of poll.options) {
            option.votes_count += Number(option.id === optionId) - Number(option.id === previousId);
            if (!poll.is_anonymous) option.voters = option.id === optionId ? [user] : [];
          }
          return respond(poll);
        }
      }
      if (method === "POST" && path === "/attachments/temporary-url") {
        const input = body as Record<string, string>;
        this.tempUrlRequests.push(input);
        const number = this.tempUrlRequests.length;
        return respond({ user_id: user.id, file_key: this.uploadKey(number), temporary_url: new URL(`/__upload/${number}`, this.page.url()).href });
      }
      if (method === "POST" && path === "/attachments/") return respond({ ...(body as TestAttachment), id: `attachment-${++this.sequence}`, text: null });
      const downloadMatch = path.match(/^\/attachments\/([^/]+)\/download$/);
      if (method === "GET" && downloadMatch) return respond({ url: new URL(`/__download/${downloadMatch[1]}`, this.page.url()).href });
      this.unexpected.push(`${method} ${path}`);
      return respond({ detail: `Unexpected test request: ${method} ${path}` }, 501);
    });
    await this.page.route("**/__upload/*", async (route) => {
      const number = Number(new URL(route.request().url()).pathname.split("/").pop());
      this.uploads.push({ key: this.uploadKey(number), body: route.request().postDataBuffer() || Buffer.alloc(0), contentType: route.request().headers()["content-type"] || "" });
      await route.fulfill({ status: 200, body: "" });
    });
    await this.page.route(/\/__(?:media|download)\//, async (route) => {
      const path = new URL(route.request().url()).pathname;
      const id = path.split("/").pop() || "";
      const media = this.media.get(id);
      const attachment = [...this.messages.values()].flat().flatMap((message) => message.attachments).find((item) => item.id === id);
      await route.fulfill({
        status: media ? 200 : 404, body: media?.body || Buffer.alloc(0),
        contentType: media?.contentType || "application/octet-stream",
        headers: path.startsWith("/__download/") ? { "content-disposition": `attachment; filename="${attachment?.file_name || "download.bin"}"` } : {},
      });
    });
  }

  private uploadKey(number: number) {
    return `user_message/${user.id}/upload-${number}.${this.tempUrlRequests[number - 1].file_extension}`;
  }

  async openChat(id = chatId) {
    await this.page.addInitScript((currentUser) => {
      localStorage.setItem("access_token", currentUser.access_token);
      localStorage.setItem("user", JSON.stringify(currentUser));
    }, user);
    await this.page.goto(`/chats/${id}`);
    await expect(this.page.locator(".chat-view__title")).toBeVisible();
  }

  socketUrl(id = chatId): string | undefined {
    return this.sockets.get(id)?.url();
  }

  async publish(event: string, data: Record<string, unknown>, id = chatId) {
    await expect.poll(() => this.sockets.has(id)).toBe(true);
    this.sockets.get(id)!.send(JSON.stringify({ event, data }));
  }

  async finishTranscription(message: TestMessage, text: string) {
    const attachment = message.attachments[0];
    attachment.text = text;
    await this.publish("attachment:text", { chat_id: message.chat_id, message_id: message.id, attachment_id: attachment.id, text, error: false }, message.chat_id);
  }
}

export const test = base.extend<{ mockApi: MockApi }>({
  mockApi: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const api = new MockApi(page);
    await api.install();
    await use(api);
    expect(api.unexpected, "Every API request must have an explicit mock").toEqual([]);
    expect(errors, "No uncaught browser errors").toEqual([]);
  }, { auto: true }],
});
