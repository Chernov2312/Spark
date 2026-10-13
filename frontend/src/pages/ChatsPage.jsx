import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  chats as chatsApi,
  messages as messagesApi,
  images as imagesApi,
  auth,
  createChatSocket,
} from "../api";

/* ---------- Утилиты времени ---------- */
function timeAgo(iso) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "только что";
  if (d < 3600) return `${Math.floor(d / 60)} мин`;
  if (d < 86400) return `${Math.floor(d / 3600)} ч`;
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}
function msgTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------- Компонент ---------- */
export default function ChatsPage() {
  const navigate = useNavigate();
  const { chatId } = useParams();
  const me = auth.getCurrentUser();

  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(true);
  const [chatsError, setChatsError] = useState(null);

  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState(null);

  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [newChat, setNewChat] = useState({
    title: "",
    description: "",
    invited: "",
  });

  const bottomRef = useRef(null);
  const socketRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  /* ---------- 1. Загрузка чатов ---------- */
  useEffect(() => {
    setChatsLoading(true);
    chatsApi
      .listChats()
      .then((data) => setChats(data))
      .catch((e) =>
        setChatsError(e.response?.data?.detail || "Не удалось загрузить чаты"),
      )
      .finally(() => setChatsLoading(false));
  }, []);

  /* ---------- 2. Загрузка сообщений при смене чата ---------- */
  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }
    setMessagesLoading(true);
    setMessagesError(null);
    messagesApi
      .listMessages(chatId)
      .then((list) => {
        // Бэкенд отдаёт от новых к старым — разворачиваем
        setMessages([...list].reverse());
      })
      .catch((e) =>
        setMessagesError(
          e.response?.data?.detail || "Не удалось загрузить сообщения",
        ),
      )
      .finally(() => setMessagesLoading(false));
  }, [chatId]);

  /* ---------- 3. WebSocket ---------- */
  useEffect(() => {
    if (!auth.isAuthenticated()) return;
    let sock;
    try {
      sock = createChatSocket({
        onEvent: (event, data) => {
          if (event === "message:new" && data.chat_id === chatId) {
            setMessages((prev) => [...prev, data]);
            setChats((prev) =>
              prev.map((c) =>
                c.id === chatId
                  ? {
                      ...c,
                      last_message: {
                        text: data.text,
                        created_at: data.created_at,
                      },
                    }
                  : c,
              ),
            );
          }
          if (event === "chat:updated") {
            setChats((prev) =>
              prev.map((c) =>
                c.id === data.chat_id
                  ? {
                      ...c,
                      title: data.title ?? c.title,
                      avatar_url: data.avatar_url ?? c.avatar_url,
                    }
                  : c,
              ),
            );
          }
          if (event === "user:typing" && data.chat_id === chatId) {
            setTypingUsers((prev) => new Set(prev).add(data.user_id));
            setTimeout(
              () =>
                setTypingUsers((prev) => {
                  const next = new Set(prev);
                  next.delete(data.user_id);
                  return next;
                }),
              3000,
            );
          }
        },
      });
      socketRef.current = sock;
    } catch (e) {
      console.warn("WebSocket не подключился:", e.message);
    }
    return () => sock?.close();
  }, [chatId]);

  /* ---------- 4. Скролл вниз ---------- */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ---------- 5. Отправка сообщения ---------- */
  const handleSend = async (e) => {
    e.preventDefault();
    if (!text.trim() || !chatId || sending) return;
    setSending(true);
    try {
      // Отправляем через HTTP (если WS не подключён — так надёжнее)
      const created = await messagesApi.sendMessage(chatId, text.trim());
      setMessages((prev) => [...prev, created]);
      setText("");
      setChats((prev) =>
        prev.map((c) =>
          c.id === chatId
            ? {
                ...c,
                last_message: {
                  text: created.text,
                  created_at: created.created_at,
                },
              }
            : c,
        ),
      );
    } catch (err) {
      setMessagesError(
        err.response?.data?.detail || "Не удалось отправить сообщение",
      );
    } finally {
      setSending(false);
    }
  };

  /* ---------- 6. Индикатор «печатает…» ---------- */
  const handleTextChange = (e) => {
    setText(e.target.value);
    if (!chatId || !socketRef.current) return;
    socketRef.current.sendTyping(chatId);
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {}, 1000);
  };

  /* ---------- 7. Создание чата ---------- */
  const handleCreateChat = async (e) => {
    e.preventDefault();
    if (!newChat.title.trim()) return;
    try {
      const created = await chatsApi.createChat({
        title: newChat.title.trim(),
        description: newChat.description.trim(),
        invited_user_ids: newChat.invited
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setChats((prev) => [created, ...prev]);
      setCreateOpen(false);
      setNewChat({ title: "", description: "", invited: "" });
      navigate(`/chats/${created.id}`);
    } catch (err) {
      alert(err.response?.data?.detail || "Не удалось создать чат");
    }
  };

  /* ---------- 8. Реакция ---------- */
  const handleReaction = async (messageId, emoji) => {
    try {
      const res = await messagesApi.addReaction(messageId, emoji);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? { ...m, reactions_count: res.updated_reactions_count }
            : m,
        ),
      );
    } catch {}
  };

  /* ---------- 9. Загрузка картинки ---------- */
  const handleImageUpload = async (file) => {
    if (!chatId) return;
    try {
      const res = await imagesApi.uploadImage(file, chatId);
      // Отправим сообщение с URL картинки (или как бэкенд ждёт)
      await messagesApi.sendMessage(chatId, `![](${res.image_url})`);
    } catch {}
  };

  const filtered = chats.filter((c) =>
    (c.title || "").toLowerCase().includes(search.toLowerCase()),
  );
  const activeChat = chats.find((c) => c.id === chatId);

  return (
    <main className="chats-page">
      {/* ---------- Левая колонка ---------- */}
      <aside
        className={`chats-sidebar ${chatId ? "chats-sidebar--hidden-mobile" : ""}`}
      >
        <div className="chats-sidebar__header">
          <input
            className="chats-search"
            type="text"
            placeholder="Поиск"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            className="chats-new"
            type="button"
            title="Новый чат"
            onClick={() => setCreateOpen(true)}
          >
            +
          </button>
        </div>

        {chatsLoading && <p className="chats-empty">Загрузка чатов…</p>}
        {chatsError && (
          <p className="chats-empty" style={{ color: "var(--danger)" }}>
            {chatsError}
          </p>
        )}

        {!chatsLoading && !chatsError && (
          <ul className="chats-list">
            {filtered.map((c) => (
              <li
                key={c.id}
                className={`chat-item ${chatId === c.id ? "chat-item--active" : ""}`}
                onClick={() => navigate(`/chats/${c.id}`)}
              >
                <div className="chat-item__avatar">
                  {c.avatar_url ? (
                    <img
                      src={c.avatar_url}
                      alt=""
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        borderRadius: "50%",
                      }}
                    />
                  ) : (
                    (c.title?.[0] || "?").toUpperCase()
                  )}
                </div>
                <div className="chat-item__body">
                  <div className="chat-item__top">
                    <span className="chat-item__title">{c.title}</span>
                    {c.last_message?.created_at && (
                      <span className="chat-item__time">
                        {timeAgo(c.last_message.created_at)}
                      </span>
                    )}
                  </div>
                  <div className="chat-item__bottom">
                    <span className="chat-item__preview">
                      {c.last_message?.text || "Нет сообщений"}
                    </span>
                  </div>
                </div>
              </li>
            ))}
            {filtered.length === 0 && (
              <li className="chats-empty">
                {search ? "Ничего не найдено" : "Пока нет чатов"}
              </li>
            )}
          </ul>
        )}
      </aside>

      {/* ---------- Правая колонка ---------- */}
      <section className={`chat-view ${!chatId ? "chat-view--empty" : ""}`}>
        {!activeChat ? (
          <div className="chat-view__placeholder">
            <div className="chat-view__placeholder-icon">💬</div>
            <p>Выберите чат слева или создайте новый</p>
          </div>
        ) : (
          <>
            <header className="chat-view__header">
              <button
                className="chat-view__back"
                type="button"
                onClick={() => navigate("/chats")}
                title="Назад"
              >
                ←
              </button>
              <div className="chat-item__avatar chat-item__avatar--sm">
                {activeChat.avatar_url ? (
                  <img
                    src={activeChat.avatar_url}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      borderRadius: "50%",
                    }}
                  />
                ) : (
                  (activeChat.title?.[0] || "?").toUpperCase()
                )}
              </div>
              <div>
                <div className="chat-view__title">{activeChat.title}</div>
                <div className="chat-view__status">
                  {typingUsers.size > 0
                    ? `${typingUsers.size} печатает…`
                    : activeChat.description || "был(а) недавно"}
                </div>
              </div>
            </header>

            <div className="chat-view__messages">
              {messagesLoading && (
                <p className="chats-empty">Загрузка сообщений…</p>
              )}
              {messagesError && (
                <p className="chats-empty" style={{ color: "var(--danger)" }}>
                  {messagesError}
                </p>
              )}

              {!messagesLoading &&
                messages.map((m) => {
                  const isMe = m.user_id === me?.id;
                  return (
                    <div key={m.id} className={`msg ${isMe ? "msg--me" : ""}`}>
                      {!isMe && (
                        <div className="msg__author">
                          @{String(m.user_id || "").slice(0, 6)}
                        </div>
                      )}
                      <div className="msg__bubble">
                        <span className="msg__text">{m.text}</span>
                        <span className="msg__time">
                          {msgTime(m.created_at)}
                        </span>
                      </div>
                      {m.reactions_count &&
                        Object.keys(m.reactions_count).length > 0 && (
                          <div className="msg__reactions">
                            {Object.entries(m.reactions_count).map(
                              ([emoji, count]) => (
                                <button
                                  key={emoji}
                                  className="reaction"
                                  onClick={() => handleReaction(m.id, emoji)}
                                >
                                  {emoji} {count}
                                </button>
                              ),
                            )}
                          </div>
                        )}
                    </div>
                  );
                })}
              <div ref={bottomRef} />
            </div>

            <form className="chat-view__composer" onSubmit={handleSend}>
              <label className="composer-btn" title="Прикрепить">
                📎
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) =>
                    e.target.files[0] && handleImageUpload(e.target.files[0])
                  }
                />
              </label>
              <input
                type="text"
                placeholder="Написать сообщение…"
                value={text}
                onChange={handleTextChange}
                disabled={sending}
              />
              <button
                type="submit"
                className="composer-btn composer-btn--send"
                disabled={sending}
                title="Отправить"
              >
                ➤
              </button>
            </form>
          </>
        )}
      </section>

      {/* ---------- Модалка создания чата ---------- */}
      {createOpen && (
        <div className="modal-backdrop" onClick={() => setCreateOpen(false)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateChat}
          >
            <h3>Новый чат</h3>
            <label className="vk-field">
              <span className="vk-field__label">Название</span>
              <input
                type="text"
                value={newChat.title}
                onChange={(e) =>
                  setNewChat((p) => ({ ...p, title: e.target.value }))
                }
                required
              />
            </label>
            <label className="vk-field">
              <span className="vk-field__label">Описание</span>
              <input
                type="text"
                value={newChat.description}
                onChange={(e) =>
                  setNewChat((p) => ({ ...p, description: e.target.value }))
                }
              />
            </label>
            <label className="vk-field">
              <span className="vk-field__label">
                ID приглашённых (через запятую)
              </span>
              <input
                type="text"
                value={newChat.invited}
                onChange={(e) =>
                  setNewChat((p) => ({ ...p, invited: e.target.value }))
                }
              />
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button type="submit" className="vk-btn vk-btn--primary">
                Создать
              </button>
              <button
                type="button"
                className="vk-btn"
                onClick={() => setCreateOpen(false)}
              >
                Отмена
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
