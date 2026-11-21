const CHAT_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

self.addEventListener("push", (event) => {
  let data;
  try { data = event.data?.json(); }
  catch { return; }
  if (typeof data?.chat_id !== "string" || !CHAT_ID.test(data.chat_id)) return;
  event.waitUntil(self.registration.showNotification("Spark", {
    body: "Новое сообщение в чате",
    icon: "/spark.svg",
    tag: "spark-chat-" + data.chat_id,
    silent: data.silent === true,
    data: { chatId: data.chat_id },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId;
  if (typeof chatId !== "string" || !CHAT_ID.test(chatId)) return;
  const url = new URL("/chats/" + chatId, self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url === url);
    if (existing) return existing.focus();
    return self.clients.openWindow(url);
  })());
});
