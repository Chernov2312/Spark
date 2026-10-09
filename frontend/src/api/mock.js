/* Заглушки для разработки без бэкенда.
   Используются, когда VITE_USE_MOCK=true в .env  */

export const mockUser = {
  id: "u1111111-eeee-aaaa-bbbb-cccccccccccc",
  username: "chel",
  email: "john@example.com",
  avatar_url: null,
  created_at: "2026-10-03T09:21:00Z",
};

const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms));

export async function mockGetMe() {
  await delay();
  const saved = localStorage.getItem("mock_user");
  return saved ? JSON.parse(saved) : { ...mockUser };
}

export async function mockUpdateMe(payload) {
  await delay();
  const current = await mockGetMe();
  const updated = { ...current, ...payload };
  localStorage.setItem("mock_user", JSON.stringify(updated));
  return updated;
}

export async function mockUploadAvatar(file) {
  await delay(600);
  // Локальный blob-URL — картинка отобразится, но не уйдёт на сервер
  const url = URL.createObjectURL(file);
  const current = await mockGetMe();
  const updated = { ...current, avatar_url: url };
  localStorage.setItem("mock_user", JSON.stringify(updated));
  return { avatar_url: url };
}

export async function mockDeleteAvatar() {
  await delay();
  const current = await mockGetMe();
  const updated = { ...current, avatar_url: null };
  localStorage.setItem("mock_user", JSON.stringify(updated));
}
