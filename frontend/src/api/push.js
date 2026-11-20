import { api } from "./client";

const STORAGE_KEY = "spark:push-subscription";
const WORKER_URL = "/push-sw.js";
const CHAT_PREFS_PREFIX = "chat-prefs:";
const CHAT_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
let pendingUpdate = Promise.resolve();

function savedSubscription() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); }
  catch { return null; }
}

export function supportsWebPush() {
  return typeof Notification !== "undefined" && "PushManager" in window && "serviceWorker" in navigator;
}

export function isWebPushEnabled(userId) {
  return Boolean(userId && savedSubscription()?.userId === userId);
}

function readChatOptions() {
  const options = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key?.startsWith(CHAT_PREFS_PREFIX)) continue;
    const chatId = key.slice(CHAT_PREFS_PREFIX.length);
    if (!CHAT_ID.test(chatId)) continue;
    try {
      const prefs = JSON.parse(localStorage.getItem(key));
      if (prefs?.muted || prefs?.sound === false) {
        options[chatId] = { muted: Boolean(prefs.muted), silent: prefs.sound === false };
      }
    } catch { /* Ignore an unreadable local preference. */ }
  }
  return options;
}

function sendSubscription(subscription, chatOptions) {
  const { endpoint, keys } = subscription.toJSON();
  return api.put("/push/subscription", { endpoint, keys, chat_options: chatOptions }, { timeout: 5000 });
}

export async function enableWebPush(userId) {
  const { data } = await api.get("/push/config", { timeout: 5000 });
  if (!data.public_key) throw new Error("Фоновые уведомления временно недоступны.");
  await navigator.serviceWorker.register(WORKER_URL, { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const expected = data.public_key.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(expected), (char) => char.charCodeAt(0));
  const existingKey = new Uint8Array(existing?.options.applicationServerKey || []);
  const matches = existingKey.length === bytes.length && bytes.every((byte, index) => existingKey[index] === byte);
  if (existing && !matches) await existing.unsubscribe();
  const subscription = matches ? existing : await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: bytes,
  });
  await sendSubscription(subscription, readChatOptions());
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, endpoint: subscription.endpoint }));
}

export function syncWebPushPreferences(userId, chatId, { muted, sound }) {
  if (!isWebPushEnabled(userId) || !CHAT_ID.test(chatId)) return Promise.resolve();
  const update = pendingUpdate.then(async () => {
    if (!isWebPushEnabled(userId)) return;
    const registration = await navigator.serviceWorker.getRegistration(WORKER_URL);
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription || !isWebPushEnabled(userId)) return;
    const options = readChatOptions();
    options[chatId] = { muted, silent: sound === false };
    await sendSubscription(subscription, options);
  });
  pendingUpdate = update.catch(() => {});
  return update;
}

export async function disableWebPush(userId) {
  const saved = savedSubscription();
  if (!userId || saved?.userId !== userId) return;
  localStorage.removeItem(STORAGE_KEY);
  // Let any earlier preference request finish before deleting the server record.
  await pendingUpdate;
  const dropServerSubscription = api.delete("/push/subscription", {
    data: { endpoint: saved.endpoint },
    timeout: 2000,
  });
  const dropBrowserSubscription = async () => {
    const registration = await navigator.serviceWorker?.getRegistration(WORKER_URL);
    if (!registration) return;
    const subscription = await registration.pushManager.getSubscription();
    const [unsubscribed, unregistered] = await Promise.allSettled([
      subscription?.unsubscribe(),
      registration.unregister(),
      registration.getNotifications().then((notifications) => {
        notifications.forEach((notification) => notification.close());
      }),
    ]);
    if (subscription && ![unsubscribed, unregistered].some((result) => result.status === "fulfilled" && result.value)) {
      throw new Error("Could not remove the browser push subscription");
    }
  };
  const [server, browser] = await Promise.allSettled([dropServerSubscription, dropBrowserSubscription()]);
  if (server.status === "rejected" && browser.status === "rejected") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    throw server.reason;
  }
}
