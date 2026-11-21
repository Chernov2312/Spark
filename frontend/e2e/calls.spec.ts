import { type Page, type WebSocketRoute } from "@playwright/test";
import { test, expect, chatId, user } from "./support";

const callId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

function mockMedia(page: Page) {
  return page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true, value: { getUserMedia: async () => new MediaStream() },
    });
  });
}

test("starts a call and creates, copies, and revokes its invite", async ({ page, context, mockApi }) => {
  await mockMedia(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  let sentAuth;
  let started;
  await page.routeWebSocket("**/v1/calls/ws", (ws) => {
    ws.onMessage((raw) => {
      const { event, data } = JSON.parse(raw.toString());
      if (event === "auth") {
        sentAuth = data;
        ws.send(JSON.stringify({ event: "auth:ok", data: { user_id: user.id, ice_servers: [] } }));
      }
      if (event === "call:start") {
        started = data;
        ws.send(JSON.stringify({ event: "call:started", data: { call_id: callId, ...data, ice_servers: [] } }));
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
  expect(sentAuth).toEqual({ access_token: user.access_token, video_slots: true });
  await page.getByRole("button", { name: "Создать гостевую ссылку" }).click();
  expect(started).toEqual({ chat_id: chatId, media: "video" });
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
  await mockMedia(page);
  let sentAuth;
  let accepted;
  await page.routeWebSocket("**/v1/calls/ws", (ws) => {
    ws.onMessage((raw) => {
      const { event, data } = JSON.parse(raw.toString());
      if (event === "auth") {
        sentAuth = data;
        ws.send(JSON.stringify({ event: "auth:ok", data: { guest: true, call_id: callId, ice_servers: [] } }));
        ws.send(JSON.stringify({ event: "call:incoming", data: { call_id: callId, caller_name: "Владелец", media: "audio" } }));
      }
      if (event === "call:accept") {
        accepted = data;
        ws.send(JSON.stringify({ event: "call:accepted", data: { call_id: callId, ice_servers: [] } }));
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
  expect(sentAuth).toEqual({ invite_token: "test", video_slots: true });
  await expect(page.getByRole("button", { name: "Завершить звонок" })).toBeEnabled();
  expect(accepted).toEqual({ call_id: callId, display_name: "Мира 🌿" });
  await page.getByRole("button", { name: "Завершить звонок" }).click();
  await expect(page.getByText("Вы покинули звонок.")).toBeVisible();
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

test("an audio call sends camera and screen independently between a member and a guest", async ({ page, context, mockApi }) => {
  const guest = await context.newPage();
  await Promise.all([useTestMedia(page), useTestMedia(guest)]);

  const guestId = "guest-peer";
  const ice_servers = [{ urls: "stun:127.0.0.1:9" }];
  let ownerSocket: WebSocketRoute;
  let guestSocket: WebSocketRoute;
  const send = (socket: WebSocketRoute, event: string, data: Record<string, unknown>) => {
    socket.send(JSON.stringify({ event, data: { call_id: callId, ...data } }));
  };
  const connect = (socket: WebSocketRoute, isGuest: boolean) => {
    if (isGuest) guestSocket = socket;
    else ownerSocket = socket;
    socket.onMessage((raw) => {
      const { event, data } = JSON.parse(raw.toString());
      if (event === "auth") {
        send(socket, "auth:ok", { ice_servers });
        if (isGuest) send(socket, "call:incoming", { caller_name: "Владелец", media: "audio" });
      } else if (event === "call:start") {
        send(socket, "call:started", { ...data, ice_servers });
      } else if (event === "call:accept") {
        send(guestSocket, "call:accepted", { peer_id: guestId, ice_servers });
        send(ownerSocket, "call:accepted", { peer_id: guestId });
        send(guestSocket, "call:peer_joined", { peer_id: user.id, display_name: "Владелец", should_offer: false, video_slots: true });
        send(ownerSocket, "call:peer_joined", { peer_id: guestId, display_name: "Гость", should_offer: true, video_slots: true });
      } else if (event.startsWith("rtc:")) {
        send(isGuest ? ownerSocket : guestSocket, event, { ...data, from_id: isGuest ? guestId : user.id });
      } else if (event === "call:end") {
        send(guestSocket, "call:ended", {});
      }
    });
  };
  await page.routeWebSocket("**/v1/calls/ws", (socket) => connect(socket, false));
  await guest.routeWebSocket("**/v1/calls/ws", (socket) => connect(socket, true));

  await mockApi.openChat();
  await page.getByRole("button", { name: "Начать звонок" }).click();
  await page.getByRole("button", { name: "Аудиозвонок" }).click();
  await page.getByRole("button", { name: "Включить камеру" }).click();
  await guest.goto("/call/join#invite=test");
  await guest.getByRole("button", { name: "Принять звонок" }).click();

  const ownerCamera = guest.getByRole("group", { name: "Владелец", exact: true }).locator("video");
  const ownerScreen = guest.getByRole("group", { name: "Владелец · экран" }).locator("video");
  await expect(ownerCamera).toHaveJSProperty("videoWidth", 96);
  await page.getByRole("button", { name: "Показать экран" }).click();
  await expect(ownerScreen).toHaveJSProperty("videoWidth", 160);
  await expect(ownerCamera).toHaveJSProperty("videoWidth", 96);

  await guest.getByRole("button", { name: "Показать экран" }).click();
  const guestScreen = page.getByRole("group", { name: "Гость · экран" }).locator("video");
  await expect(guestScreen).toHaveJSProperty("videoWidth", 160);
  await guest.getByRole("button", { name: "Остановить показ экрана" }).click();
  await expect(guestScreen).toHaveCount(0);

  await page.getByRole("button", { name: "Выключить камеру" }).click();
  await expect(ownerCamera).toHaveCount(0);
  await expect(ownerScreen).toHaveJSProperty("videoWidth", 160);
  await page.getByRole("group", { name: "Ваш экран" }).locator("video").evaluate((video: HTMLVideoElement) => {
    const [track] = (video.srcObject as MediaStream).getVideoTracks();
    track.stop();
    track.dispatchEvent(new Event("ended"));
  });
  await expect(ownerScreen).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Показать экран" })).toBeEnabled();

  await page.getByRole("button", { name: "Включить камеру" }).click();
  await page.getByRole("button", { name: "Показать экран" }).click();
  await expect(ownerCamera).toHaveJSProperty("videoWidth", 96);
  await expect(ownerScreen).toHaveJSProperty("videoWidth", 160);
  const localTracks = await page.getByRole("dialog").evaluateHandle((dialog) =>
    Array.from(dialog.querySelectorAll("video"), (video) => (video.srcObject as MediaStream).getVideoTracks()[0]),
  );
  await expect.poll(() => localTracks.evaluate((tracks) => tracks.map((track) => track.readyState))).toEqual(["live", "live"]);
  await page.getByRole("button", { name: "Завершить звонок" }).click();
  await expect(guest.getByText("Вы покинули звонок.")).toBeVisible();
  await expect.poll(() => localTracks.evaluate((tracks) => tracks.map((track) => track.readyState))).toEqual(["ended", "ended"]);
});
