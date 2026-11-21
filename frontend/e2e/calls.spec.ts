import { type Page, type WebSocketRoute } from "@playwright/test";
import { test, expect, chatId, user } from "./support";

const callId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

async function mockMedia(page: Page) {
  const requests: MediaStreamConstraints[] = [];
  await page.exposeFunction("recordMediaRequest", (constraints: MediaStreamConstraints) => {
    requests.push(constraints);
  });
  await page.addInitScript(() => {
    const { recordMediaRequest } = window as typeof window & {
      recordMediaRequest: (constraints: MediaStreamConstraints) => Promise<void>;
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        async getUserMedia(constraints: MediaStreamConstraints) {
          await recordMediaRequest(constraints);
          return new MediaStream();
        },
      },
    });
  });
  return requests;
}

function mockLiveKit(page: Page) {
  return page.route((url) => /\/livekit-client(?:\.esm(?:-[^/]+)?)?\.(?:js|mjs)$/.test(url.pathname), (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
        export const ConnectionQuality = { Lost: "lost" };
        export const RoomEvent = Object.fromEntries([
          "ParticipantConnected", "ParticipantDisconnected", "TrackPublished", "TrackUnpublished",
          "TrackSubscribed", "TrackUnsubscribed", "TrackMuted", "TrackUnmuted", "ConnectionQualityChanged",
          "Reconnecting", "Reconnected", "AudioPlaybackStatusChanged", "Disconnected",
        ].map(name => [name, name]));
        export class Room {
          listeners = new Map();
          remoteParticipants = new Map();
          publications = new Map();
          localParticipant = {
            getTrackPublication: source => this.publications.get(source),
            publishTrack: async (track, { source }) => {
              const publication = {
                track,
                isMuted: false,
                mute: async () => {
                  track.enabled = false;
                  publication.isMuted = true;
                  this.emit("TrackMuted");
                },
                unmute: async () => {
                  track.enabled = true;
                  publication.isMuted = false;
                  this.emit("TrackUnmuted");
                },
              };
              this.publications.set(source, publication);
              this.reportSources();
              return publication;
            },
            unpublishTrack: async (track) => {
              for (const [source, publication] of this.publications) {
                if (publication.track === track) this.publications.delete(source);
              }
              this.reportSources();
            },
          };
          reportSources() {
            document.body.dataset.livekitSources = [...this.publications.keys()].sort().join(",");
          }
          updateRemote = ({ detail }) => {
            const { identity, muted, lost } = detail;
            this.remoteParticipants.set(identity, {
              identity,
              connectionQuality: lost ? "lost" : "good",
              getTrackPublication: source => source === "microphone" ? { isMuted: muted } : undefined,
            });
            this.emit("ConnectionQualityChanged");
          };
          on(event, listener) {
            this.listeners.set(event, listener);
            return this;
          }
          emit(event) {
            this.listeners.get(event)?.();
          }
          removeAllListeners() {
            this.listeners.clear();
          }
          async connect(url, token) {
            document.body.dataset.livekitUrl = url;
            document.body.dataset.livekitToken = token;
            window.addEventListener("test-livekit-peer", this.updateRemote);
          }
          async disconnect() {
            window.removeEventListener("test-livekit-peer", this.updateRemote);
            delete document.body.dataset.livekitToken;
          }
        }
      `,
    }));
}

test("starts a call and creates, copies, and revokes its invite", async ({ page, context, mockApi }) => {
  const mediaRequests = await mockMedia(page);
  await mockLiveKit(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let sentAuth;
  let started;
  await page.routeWebSocket("**/v1/calls/ws", (ws) => {
    ws.onMessage((raw) => {
      const { event, data } = JSON.parse(raw.toString());
      if (event === "auth") {
        sentAuth = data;
        ws.send(JSON.stringify({ event: "auth:ok", data: { user_id: user.id } }));
      }
      if (event === "call:check") ws.send(JSON.stringify({ event: "call:checked", data: { media_ready: true } }));
      if (event === "call:start") {
        started = data;
        ws.send(JSON.stringify({ event: "call:started", data: { call_id: callId, ...data, media_token: "member-token" } }));
      }
    });
  });
  const inviteUrl = "https://spark.example/call/join#invite=test";
  let inviteAuthorization;
  let revoked = false;
  await page.route(`**/v1/calls/${callId}/invites`, (route) => {
    inviteAuthorization = route.request().headers().authorization;
    return route.fulfill({ status: 201, json: { invite_id: "invite-id", invite_url: inviteUrl } });
  });
  await page.route("**/v1/calls/invites/invite-id", (route) => {
    revoked = route.request().method() === "DELETE";
    return route.fulfill({ status: 204 });
  });

  await mockApi.openChat();
  await page.getByRole("button", { name: "Начать звонок" }).click();
  await page.getByRole("button", { name: "Видеозвонок" }).click();
  await expect(page.getByRole("form", { name: "Проверка перед звонком" }).getByRole("status")).toHaveText("Медиасервер доступен");
  expect(started).toBeUndefined();
  await page.getByRole("button", { name: "Подключиться", exact: true }).click();
  expect(sentAuth).toEqual({ access_token: user.access_token });
  await expect(page.locator("body")).toHaveAttribute("data-livekit-token", "member-token");
  await expect(page.locator("body")).toHaveAttribute("data-livekit-url", /\/v1\/calls\/media$/);
  await page.getByRole("button", { name: "Создать гостевую ссылку" }).click();
  expect(started).toEqual({ chat_id: chatId, media: "video" });
  expect(mediaRequests).toEqual([{ audio: true, video: true }]);
  const guestLink = page.getByRole("textbox", { name: "Гостевая ссылка" });
  await expect(guestLink).toHaveValue(inviteUrl);
  expect(inviteAuthorization).toBe("Bearer " + user.access_token);
  await guestLink.click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText("Ссылка скопирована");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(inviteUrl);
  await page.getByRole("button", { name: "Отозвать ссылку" }).click();
  await expect(guestLink).toHaveCount(0);
  expect(revoked).toBe(true);
});

test("a guest chooses a nickname before joining without a Spark account", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Linux; Android 16; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36",
    });
  });
  const mediaRequests = await mockMedia(page);
  await mockLiveKit(page);
  let sentAuth;
  let accepted;
  await page.routeWebSocket("**/v1/calls/ws", (ws) => {
    ws.onMessage((raw) => {
      const { event, data } = JSON.parse(raw.toString());
      if (event === "auth") {
        sentAuth = data;
        ws.send(JSON.stringify({ event: "auth:ok", data: { guest: true, call_id: callId } }));
        ws.send(JSON.stringify({ event: "call:incoming", data: { call_id: callId, caller_name: "Владелец", media: "audio" } }));
      }
      if (event === "call:check") ws.send(JSON.stringify({ event: "call:checked", data: { media_ready: true } }));
      if (event === "call:accept") {
        accepted = data;
        ws.send(JSON.stringify({ event: "call:accepted", data: { call_id: callId, media_token: "guest-token" } }));
      }
    });
  });
  await page.goto("/call/join#invite=test");
  await expect(page).toHaveURL(/\/call\/join$/);
  const nickname = page.getByRole("textbox", { name: "Ник в звонке" });
  await nickname.fill("я".repeat(51));
  await nickname.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Введите ник до 50 символов");
  expect(accepted).toBeUndefined();
  await nickname.fill("  Мира 🌿  ");
  await nickname.press("Enter");
  expect(sentAuth).toEqual({ invite_token: "test" });
  await expect(page.getByRole("button", { name: "Завершить звонок" })).toBeEnabled();
  expect(accepted).toEqual({ call_id: callId, display_name: "Мира 🌿" });
  expect(mediaRequests).toEqual([{
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  }]);
  await expect(page.locator("body")).toHaveAttribute("data-livekit-token", "guest-token");
  await page.getByRole("button", { name: "Завершить звонок" }).click();
  await expect(page.getByText("Вы покинули звонок.")).toBeVisible();
});

test("shows LiveKit participant states and publishes camera and screen independently", async ({ page }) => {
  await useTestMedia(page);
  await mockLiveKit(page);
  let socket: WebSocketRoute;
  const send = (event: string, data: Record<string, unknown> = {}) => {
    socket.send(JSON.stringify({ event, data: { call_id: callId, ...data } }));
  };
  await page.routeWebSocket("**/v1/calls/ws", (ws) => {
    socket = ws;
    socket.onMessage((raw) => {
      const { event } = JSON.parse(raw.toString());
      if (event === "auth") {
        send("auth:ok");
        send("call:incoming", { caller_name: "Владелец", media: "audio" });
      } else if (event === "call:accept") {
        send("call:accepted", { media_token: "guest-token" });
        send("call:peer_joined", { peer_id: user.id, display_name: "Владелец" });
        send("call:peer_joined", { peer_id: "other", display_name: "Другой гость" });
      }
    });
  });
  const updateRemote = (identity: string, muted: boolean, lost = false) =>
    page.evaluate((detail) => window.dispatchEvent(new CustomEvent("test-livekit-peer", { detail })),
      { identity, muted, lost });

  await page.goto("/call/join#invite=test");
  await page.getByRole("button", { name: "Подключиться", exact: true }).click();
  const ownerTile = page.getByRole("group", { name: "Владелец" });
  const otherTile = page.getByRole("group", { name: "Другой гость" });
  const localTile = page.getByRole("group", { name: "Вы" });
  const connectionLost = { name: "Связь прервана" };
  const microphoneOff = { name: "Микрофон выключен" };
  const microphoneOn = { name: "Микрофон включён" };
  await expect(otherTile.getByRole("img", { name: "Подключение…" })).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-livekit-sources", "microphone");
  await updateRemote(user.id, true);
  await expect(ownerTile.getByRole("img", microphoneOff)).toBeVisible();
  await updateRemote("other", false, true);
  await expect(otherTile.getByRole("img", connectionLost)).toBeVisible();
  await expect(ownerTile.getByRole("img", connectionLost)).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await updateRemote("other", false);
  await expect(otherTile.getByRole("img", connectionLost)).toHaveCount(0);

  await page.getByRole("button", { name: "Выключить микрофон" }).click();
  await expect(localTile.getByRole("img", microphoneOff)).toBeVisible();
  await page.getByRole("button", { name: "Включить микрофон" }).click();
  await expect(localTile.getByRole("img", microphoneOn)).toBeVisible();

  await page.getByRole("button", { name: "Включить камеру" }).click();
  await page.getByRole("button", { name: "Показать экран" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-livekit-sources", "camera,microphone,screen_share");
  const screenTrack = await page.getByRole("group", { name: "Ваш экран" }).locator("video").evaluateHandle((video: HTMLVideoElement) =>
    (video.srcObject as MediaStream).getVideoTracks()[0],
  );
  await screenTrack.evaluate((track) => {
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  await expect(page.locator("body")).toHaveAttribute("data-livekit-sources", "camera,microphone");
  const cameraTrack = await localTile.locator("video").evaluateHandle((video: HTMLVideoElement) =>
    (video.srcObject as MediaStream).getVideoTracks()[0],
  );
  await page.getByRole("button", { name: "Завершить звонок" }).click();
  await expect(page.getByText("Вы покинули звонок.")).toBeVisible();
  await expect.poll(() => cameraTrack.evaluate((track) => track.readyState)).toBe("ended");
  await expect(page.locator("body")).not.toHaveAttribute("data-livekit-token", /.+/);
});

function useTestMedia(page: Page) {
  return page.addInitScript(() => {
    const videoTrack = (width: number, height: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      const [track] = canvas.captureStream(10).getVideoTracks();
      let frame = 0;
      const timer = window.setInterval(() => {
        if (track.readyState === "ended") {
          window.clearInterval(timer);
          return;
        }
        context.fillStyle = frame++ % 2 ? "green" : "blue";
        context.fillRect(0, 0, width, height);
      }, 100);
      return track;
    };

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        async getUserMedia({ audio, video }: MediaStreamConstraints) {
          const stream = new MediaStream();
          if (audio) {
            const destination = new AudioContext().createMediaStreamDestination();
            stream.addTrack(destination.stream.getAudioTracks()[0]);
          }
          if (video) stream.addTrack(videoTrack(96, 64));
          return stream;
        },
        async getDisplayMedia() {
          return new MediaStream([videoTrack(160, 90)]);
        },
      },
    });
  });
}

test("shows an active chat call and joins it after the lobby", async ({ page, mockApi }) => {
  await mockMedia(page);
  await mockLiveKit(page);
  let socket: WebSocketRoute;
  let accepted: unknown;
  const send = (event: string, data: Record<string, unknown>) => socket.send(JSON.stringify({ event, data }));
  await page.routeWebSocket("**/v1/calls/ws", (ws) => {
    socket = ws;
    ws.onMessage((raw) => {
      const { event, data } = JSON.parse(raw.toString());
      if (event === "auth") send("auth:ok", { user_id: user.id });
      if (event === "call:watch" && data.chat_id === chatId) {
        send("call:status", { chat_id: chatId, call_id: callId, media: "audio", caller_name: "Владелец", participant_count: 2 });
      }
      if (event === "call:check") send("call:checked", { media_ready: true });
      if (event === "call:join") {
        accepted = data;
        send("call:accepted", { call_id: callId, media_token: "late-member-token" });
      }
    });
  });

  await mockApi.openChat();
  await expect(page.getByText("Идёт аудиозвонок")).toBeVisible();
  await page.getByRole("button", { name: "Присоединиться" }).click();
  await expect(page.getByText("Уже в звонке: 2")).toBeVisible();
  expect(accepted).toBeUndefined();
  await page.getByRole("button", { name: "Подключиться", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-livekit-token", "late-member-token");
  expect(accepted).toEqual({ call_id: callId });
  send("call:ended", { call_id: callId });
  send("call:status", { chat_id: chatId });
  await expect(page.getByText("Идёт аудиозвонок")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Звонок" })).toHaveCount(0);
});

test("previews devices and starts a standalone call from the header", async ({ page, mockApi }) => {
  await useTestMedia(page);
  await mockLiveKit(page);
  let started: unknown;
  await page.routeWebSocket("**/v1/calls/ws", (ws) => {
    const send = (event: string, data: Record<string, unknown>) => ws.send(JSON.stringify({ event, data }));
    ws.onMessage((raw) => {
      const { event, data } = JSON.parse(raw.toString());
      if (event === "auth") send("auth:ok", { user_id: user.id });
      if (event === "call:check") send("call:checked", { media_ready: true });
      if (event === "call:start") {
        started = data;
        send("call:started", { call_id: callId, ...data, media_token: "standalone-token" });
      }
    });
  });

  await mockApi.openChat();
  await page.getByRole("button", { name: "Звонки", exact: true }).click();
  await page.getByRole("button", { name: "Видеозвонок" }).click();
  await page.getByRole("button", { name: "Проверить камеру и микрофон" }).click();
  const preview = page.locator("video[aria-label='Предпросмотр камеры']");
  await expect(preview).toBeVisible();
  const previewTrack = await preview.evaluateHandle((video: HTMLVideoElement) =>
    (video.srcObject as MediaStream).getVideoTracks()[0],
  );
  await expect(page.getByText("Уровень микрофона")).toBeVisible();
  expect(started).toBeUndefined();
  await page.getByRole("button", { name: "Подключиться", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute("data-livekit-token", "standalone-token");
  expect(started).toEqual({ media: "video" });
  await expect.poll(() => previewTrack.evaluate((track) => track.readyState)).toBe("ended");
  await expect(page.getByRole("button", { name: "Создать гостевую ссылку" })).toBeEnabled();
});
