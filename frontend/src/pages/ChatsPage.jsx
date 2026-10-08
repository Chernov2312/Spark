import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

/* ---------- Mock-данные (замени на API позже) ---------- */
const MOCK_CHATS = [
  {
    id: "c1",
    title: "Команда разработки",
    avatar_url: null,
    last_message: {
      text: "Иван: завтра деплой в 10:00",
      created_at: "2026-10-09T14:20:00Z",
    },
    unread: 2,
  },
  {
    id: "c2",
    title: "Мария Смирнова",
    avatar_url: null,
    last_message: {
      text: "Скинь, пожалуйста, макет",
      created_at: "2026-10-09T13:05:00Z",
    },
    unread: 0,
  },
  {
    id: "c3",
    title: "Spark Support",
    avatar_url: null,
    last_message: {
      text: "Ваш запрос обработан ✅",
      created_at: "2026-10-08T18:42:00Z",
    },
    unread: 0,
  },
  {
    id: "c4",
    title: "Общий чат",
    avatar_url: null,
    last_message: {
      text: "Алексей: кто идёт на митап?",
      created_at: "2026-10-07T11:11:00Z",
    },
    unread: 0,
  },
];

const MOCK_MESSAGES = {
  c1: [
    {
      id: "m1",
      user: "Мария",
      text: "Всем привет! Готовы к релизу?",
      time: "14:10",
    },
    {
      id: "m2",
      user: "Иван",
      text: "Почти. Осталось прогнать тесты",
      time: "14:12",
    },
    {
      id: "m3",
      user: "chel",
      text: "Могу помочь с проверкой",
      time: "14:15",
      me: true,
    },
    { id: "m4", user: "Иван", text: "завтра деплой в 10:00", time: "14:20" },
  ],
  c2: [
    {
      id: "m1",
      user: "Мария",
      text: "Скинь, пожалуйста, макет",
      time: "13:05",
    },
  ],
  c3: [
    {
      id: "m1",
      user: "Support",
      text: "Здравствуйте! Чем можем помочь?",
      time: "18:40",
    },
    {
      id: "m2",
      user: "Support",
      text: "Ваш запрос обработан ✅",
      time: "18:42",
    },
  ],
  c4: [
    { id: "m1", user: "Алексей", text: "кто идёт на митап?", time: "11:11" },
  ],
};

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "только что";
  if (diff < 3600) return `${Math.floor(diff / 60)} мин`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч`;
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
  });
}

/* ---------- Компонент ---------- */
export default function ChatsPage() {
  const navigate = useNavigate();
  const { chatId } = useParams();
  const [chats] = useState(MOCK_CHATS);
  const [search, setSearch] = useState("");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const bottomRef = useRef(null);

  const activeChat = chats.find((c) => c.id === chatId);

  useEffect(() => {
    if (chatId) {
      setMessages(MOCK_MESSAGES[chatId] || []);
    }
  }, [chatId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const filtered = chats.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase()),
  );

  const handleSend = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        user: "chel",
        text: text.trim(),
        time: new Date().toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        me: true,
      },
    ]);
    setText("");
  };

  const handleSelect = (id) => navigate(`/chats/${id}`);

  return (
    <main className="chats-page">
      {/* ---------- Левая колонка: список чатов ---------- */}
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
          <button className="chats-new" type="button" title="Новый чат">
            +
          </button>
        </div>

        <ul className="chats-list">
          {filtered.map((c) => (
            <li
              key={c.id}
              className={`chat-item ${chatId === c.id ? "chat-item--active" : ""}`}
              onClick={() => handleSelect(c.id)}
            >
              <div className="chat-item__avatar">
                {c.title[0]?.toUpperCase()}
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
                  {c.unread > 0 && (
                    <span className="chat-item__badge">{c.unread}</span>
                  )}
                </div>
              </div>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="chats-empty">Ничего не найдено</li>
          )}
        </ul>
      </aside>

      {/* ---------- Правая колонка: чат или заглушка ---------- */}
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
                {activeChat.title[0]?.toUpperCase()}
              </div>
              <div>
                <div className="chat-view__title">{activeChat.title}</div>
                <div className="chat-view__status">был(а) недавно</div>
              </div>
            </header>

            <div className="chat-view__messages">
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.me ? "msg--me" : ""}`}>
                  {!m.me && <div className="msg__author">{m.user}</div>}
                  <div className="msg__bubble">
                    <span className="msg__text">{m.text}</span>
                    <span className="msg__time">{m.time}</span>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <form className="chat-view__composer" onSubmit={handleSend}>
              <button type="button" className="composer-btn" title="Прикрепить">
                📎
              </button>
              <input
                type="text"
                placeholder="Написать сообщение…"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                type="submit"
                className="composer-btn composer-btn--send"
                title="Отправить"
              >
                ➤
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
