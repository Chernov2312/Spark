import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  chats as chatsApi,
  messages as messagesApi,
  attachments as attachmentsApi,
  auth,
  createChatSocket,
  translateApiError,
} from "../api";
import FormatToolbar from "../components/FormatToolbar";

/* ============================================================
   Утилиты времени
   ============================================================ */

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

/* ============================================================
   Рендер markdown (безопасный мини-парсер, без ссылок)
   ============================================================ */

function renderMarkdown(text) {
  if (!text) return "";
  let html = String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

  html = html
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>")
    .replace(/`([^`]+?)`/g, "<code>$1</code>")
    .replace(/(^|\s)\*([^*\n]+?)\*(?=\s|$)/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br/>");

  return html;
}

/* ============================================================
   Набор эмодзи для реакций
   ============================================================ */

const EMOJI_SET = ["👍", "❤️", "🔥", "😂", "😮", "😢", "🎉", "👏"];

function getChatAvatarUrls(chat) {
  const avatarUrls = Array.isArray(chat?.avatar_urls)
    ? chat.avatar_urls.filter((url) => typeof url === "string" && url)
    : [];
  if (avatarUrls.length) return avatarUrls;
  return chat?.avatar_url ? [chat.avatar_url] : [];
}

function ChatAvatar({ chat, compact = false }) {
  const urls = getChatAvatarUrls(chat);
  const visibleUrls = urls.slice(0, 4);

  return (
    <div
      className={`chat-item__avatar${compact ? " chat-item__avatar--sm" : ""}${visibleUrls.length > 1 ? ` chat-item__avatar--multiple chat-item__avatar--count-${visibleUrls.length}` : ""}`}
      aria-label={`Аватары группы ${chat.title}`}
    >
      {visibleUrls.length ? (
        visibleUrls.map((url, index) => (
          <span className="chat-item__avatar-cell" key={`${url}-${index}`}>
            <img src={url} alt="" />
            {index === 3 && urls.length > 4 && (
              <span className="chat-item__avatar-overflow">
                +{urls.length - 3}
              </span>
            )}
          </span>
        ))
      ) : (
        (chat.title?.[0] || "?").toUpperCase()
      )}
    </div>
  );
}

/* ============================================================
   Компонент одного вложения (единый формат)
   ============================================================ */

const AttachmentItem = React.memo(function AttachmentItem({ attachment }) {
  const {
    id,
    file_key,
    file_name,
    mime_type,
    text: attachmentText,
    transcription_error: transcriptionError,
  } = attachment;
  const isImage = typeof mime_type === "string" && mime_type.startsWith("image/");
  const isAudio =
    (typeof mime_type === "string" && mime_type.startsWith("audio/")) ||
    /\.(wav|mp3|ogg|opus|m4a|aac|flac|webm)$/i.test(file_name || "");
  const isText =
    (typeof mime_type === "string" && mime_type.startsWith("text/")) ||
    /\.(txt|md|csv|json|xml|log)$/i.test(file_name || "");
  const fileName = file_name || "Вложение";

  if (!file_key) return null;

  return (
    <div className={`msg__attachment${isImage ? " msg__attachment--image" : ""}`} key={id}>
      {isImage && (
        <a href={file_key} target="_blank" rel="noreferrer">
          <img
            className="msg__attachment-image"
            src={file_key}
            alt={fileName}
            loading="lazy"
          />
        </a>
      )}
      {isAudio && (
        <audio className="msg__attachment-audio" controls preload="none" src={file_key}>
          Ваш браузер не поддерживает аудио.
        </audio>
      )}
      {(isText ||
        isAudio ||
        (attachmentText !== null && attachmentText !== undefined)) && (
        <div className="msg__attachment-text">
          <div className="msg__attachment-text-title">
            {isAudio ? "Распознанный текст" : fileName}
          </div>
          {transcriptionError ? (
            <div className="msg__attachment-text-content">
              Не удалось распознать аудио.
            </div>
          ) : attachmentText !== null && attachmentText !== undefined ? (
            <div className="msg__attachment-text-content">
              {attachmentText || (isAudio ? "Речь не распознана." : "Файл пуст.")}
            </div>
          ) : (
            <div className="msg__attachment-text-content msg__attachment-text-content--pending">
              Текст появится после загрузки файла.
            </div>
          )}
        </div>
      )}
      {!isImage && !isAudio && (
        <a
          className="msg__attachment-link"
          href={file_key}
          target="_blank"
          rel="noreferrer"
          download={fileName}
        >
          {fileName}
        </a>
      )}
    </div>
  );
});

/* ============================================================
   Компонент одного сообщения
   ============================================================ */

const MessageItem = React.memo(function MessageItem({
  message: m,
  isMe,
  onReaction,
  onContextMenu,
}) {
  const html = useMemo(() => renderMarkdown(m.text), [m.text]);
  const attachments = Array.isArray(m.attachments) ? m.attachments : [];
  const reactions = m.reactions_count || {};
  const hasReactions = Object.keys(reactions).length > 0;

  return (
    <div
      className={`msg ${isMe ? "msg--me" : ""}`}
      onContextMenu={(e) => onContextMenu(e, m.id)}
      title="Правый клик — добавить реакцию"
    >
      {!isMe && (
        <div className="msg__author">
          {m.user_name || (m.user_id ? `@${String(m.user_id).slice(0, 6)}` : "")}
        </div>
      )}
      <div className="msg__bubble">
        {m.text && (
          <span
            className="msg__text"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        {attachments.map((a) => (
          <AttachmentItem key={a.id || a.file_key} attachment={a} />
        ))}

        <span className="msg__time">{msgTime(m.created_at)}</span>
      </div>

      {hasReactions && (
        <div className="msg__reactions">
          {Object.entries(reactions).map(([emoji, count]) => (
            <button
              key={emoji}
              type="button"
              className={`reaction ${m.user_reaction === emoji ? "reaction--active" : ""}`}
              onClick={() => onReaction(m.id, emoji)}
            >
              {emoji} {count}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

/* ============================================================
   Главный компонент страницы
   ============================================================ */

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
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [newChat, setNewChat] = useState({
    title: "",
    description: "",
  });
  const [usernameQuery, setUsernameQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [selectedAvatarFiles, setSelectedAvatarFiles] = useState([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [userSearchError, setUserSearchError] = useState(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const [uploadingChatAvatars, setUploadingChatAvatars] = useState(false);
  const [createChatError, setCreateChatError] = useState(null);
  const [chatAvatarError, setChatAvatarError] = useState(null);

  const [showFormat, setShowFormat] = useState(false);
  const [reactionPicker, setReactionPicker] = useState(null);

  const bottomRef = useRef(null);
  const socketRef = useRef(null);
  const socketOpenRef = useRef(false);
  const typingSentAtRef = useRef(0);
  const typingUsersTimeoutsRef = useRef(new Map());
  const textareaRef = useRef(null);
  const sendingRef = useRef(false);
  const blurTimeoutRef = useRef(null);

  // Тикер для обновления относительного времени ("только что" -> "1 мин")
  const [, tick] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const query = usernameQuery.trim();
    if (query.length < 2) {
      setUserSearchResults([]);
      setUserSearchError(null);
      setUserSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setUserSearchLoading(true);
      setUserSearchError(null);
      try {
        const users = await chatsApi.searchUsersByUsername(query);
        if (!cancelled) {
          setUserSearchResults(
            users.filter(
              (user) =>
                user.id !== me?.id &&
                !selectedUsers.some((selected) => selected.id === user.id),
            ),
          );
        }
      } catch (error) {
        if (!cancelled) {
          setUserSearchError(
            error.response?.data?.detail || "Не удалось найти пользователей",
          );
        }
      } finally {
        if (!cancelled) setUserSearchLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [usernameQuery, selectedUsers, me?.id]);

  /* ---------- 1. Загрузка чатов ---------- */
  useEffect(() => {
    let cancelled = false;
    setChatsLoading(true);
    chatsApi
      .listChats()
      .then((data) => {
        if (!cancelled) setChats(data);
      })
      .catch((e) => {
        if (!cancelled)
          setChatsError(
            e.response?.data?.detail || "Не удалось загрузить чаты",
          );
      })
      .finally(() => {
        if (!cancelled) setChatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------- 2. Загрузка сообщений + сброс композера при смене чата ---------- */
  useEffect(() => {
    // Сбрасываем состояние композера при переходе между чатами
    setText("");
    setSelectedFiles([]);
    setShowFormat(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    if (!chatId) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setMessagesLoading(true);
    setMessagesError(null);

    messagesApi
      .listMessages(chatId)
      .then((list) => {
        if (cancelled) return;
        // list уже в едином формате MessageResponse
        const ordered = Array.isArray(list) ? list : [];
        setMessages(
          [...ordered].sort(
            (a, b) => new Date(a.created_at) - new Date(b.created_at),
          ),
        );
      })
      .catch((e) => {
        if (!cancelled)
          setMessagesError(
            e.response?.data?.detail || "Не удалось загрузить сообщения",
          );
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chatId]);

  /* ---------- 3. WebSocket ---------- */
  useEffect(() => {
    if (!auth.isAuthenticated() || !chatId) return;

    socketOpenRef.current = false;
    let sock;

    try {
      sock = createChatSocket(chatId, {
        onOpen: () => {
          socketOpenRef.current = true;
          console.info("[WS] Подключён к чату", chatId);
        },
        onEvent: (event, data) => {
          if (event === "message:new" && data.chat_id === chatId) {
            setMessages((prev) => {
              const exists = prev.some((m) => m.id === data.id);
              if (exists) return prev;
              return [...prev, data];
            });
            setChats((prev) =>
              prev.map((c) =>
                c.id === chatId
                  ? {
                      ...c,
                      last_message: {
                        text: data.text || "Вложение",
                        created_at: data.created_at,
                      },
                    }
                  : c,
              ),
            );
          }

          if (event === "attachment:text" && data.chat_id === chatId) {
            setMessages((prev) =>
              prev.map((message) =>
                message.id !== data.message_id
                  ? message
                  : {
                      ...message,
                      attachments: (message.attachments || []).map((attachment) =>
                        attachment.id === data.attachment_id
                          ? {
                              ...attachment,
                              text: data.text,
                              transcription_error: data.error,
                            }
                          : attachment,
                      ),
                    },
              ),
            );
          }

          if (event === "chat:update" && data.chat_id === chatId) {
            setChats((prev) =>
              prev.map((c) =>
                c.id === data.chat_id
                  ? {
                      ...c,
                      title: data.title ?? c.title,
                      avatar_url: data.avatar_url ?? getChatAvatarUrl(c),
                    }
                  : c,
              ),
            );
          }

          if (event === "user:typing" && data.chat_id === chatId) {
            const uid = data.user_id;
            if (uid === me?.id) return;

            const existing = typingUsersTimeoutsRef.current.get(uid);
            if (existing) clearTimeout(existing);

            setTypingUsers((prev) => new Set(prev).add(uid));

            const t = setTimeout(() => {
              setTypingUsers((prev) => {
                const next = new Set(prev);
                next.delete(uid);
                return next;
              });
              typingUsersTimeoutsRef.current.delete(uid);
            }, 3000);
            typingUsersTimeoutsRef.current.set(uid, t);
          }
        },
        onClose: (e) => {
          socketOpenRef.current = false;
          console.info("[WS] Закрыт:", e.code, e.reason);
        },
        onError: () => {},
      });
      socketRef.current = sock;
    } catch (e) {
      console.error("[WS Component Error]", e);
    }

    return () => {
      sock?.close();
      if (socketRef.current === sock) socketRef.current = null;
      socketOpenRef.current = false;

      typingUsersTimeoutsRef.current.forEach((t) => clearTimeout(t));
      typingUsersTimeoutsRef.current.clear();
      setTypingUsers(new Set());
    };
    // me?.id намеренно не в зависимостях: сокет пересоздаётся только при смене чата
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  /* ---------- 4. Скролл вниз ---------- */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ---------- 5. Отправка сообщения ---------- */
  const handleSend = useCallback(
    async (e) => {
      if (e) e.preventDefault();
      if (sendingRef.current) return;
      if ((!text.trim() && selectedFiles.length === 0) || !chatId) return;

      sendingRef.current = true;
      setSending(true);
      setMessagesError(null);

      try {
        // 1) Загружаем файлы — каждый ответ в едином формате AttachmentResponse
        const uploaded = await Promise.all(
          selectedFiles.map(async (file) => {
            const isText =
              file.type.startsWith("text/") ||
              /\.(txt|md|csv|json|xml|log)$/i.test(file.name);
            const fileText = isText ? await file.text() : null;
            return {
              ...(await attachmentsApi.uploadAttachment(file, chatId)),
              text: fileText,
            };
          }),
        );

        // 2) Формируем вложения в формате AttachmentRequest.
        const attachmentRequests = uploaded.map((a) => ({
          id: a.id,
          chat_id: chatId,
          file_key: a.file_key,
          file_name: a.file_name,
          file_size: a.file_size,
          mime_type: a.mime_type,
          text: a.text ?? null,
        }));

        const messageText = text.trim() || null;

        // 3) Отправляем сообщение — ответ в едином формате MessageResponse
        const created = await messagesApi.sendMessage(chatId, {
          text: messageText,
          attachments: attachmentRequests,
        });

        // 4) Мержим в список по id (защита от дубля с WS)
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === created.id);
          if (idx === -1) return [...prev, created];
          const next = [...prev];
          next[idx] = { ...next[idx], ...created };
          return next;
        });

        setChats((prev) =>
          prev.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  last_message: {
                    text: created.text || "Вложение",
                    created_at: created.created_at,
                  },
                }
              : c,
          ),
        );

        setText("");
        setSelectedFiles([]);
        setShowFormat(false);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      } catch (err) {
        setMessagesError(
          translateApiError(
            err,
            err.message || "Не удалось отправить сообщение",
          ),
        );
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [chatId, selectedFiles, text],
  );

  /* ---------- 6. Ввод текста + typing (с дебаунсом) ---------- */
  const handleTextChange = (e) => {
    setText(e.target.value);

    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";

    if (!chatId || !socketRef.current || !socketOpenRef.current) return;

    const now = Date.now();
    if (now - typingSentAtRef.current < 1000) return;
    typingSentAtRef.current = now;

    try {
      socketRef.current.send("user:typing", { chat_id: chatId });
    } catch {
      // сокет мог закрыться между проверкой и send — игнорируем
    }
  };

  /* ---------- 7. Форматирование ---------- */
  const applyFormat = (openMark, closeMark) => {
    const el = textareaRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const value = el.value;

    const selected = value.slice(start, end);
    const before = value.slice(0, start);
    const after = value.slice(end);

    const inner = selected || "";
    const newText = `${before}${openMark}${inner}${closeMark}${after}`;

    setText(newText);

    requestAnimationFrame(() => {
      el.focus();
      if (selected) {
        el.setSelectionRange(
          start + openMark.length,
          start + openMark.length + inner.length,
        );
      } else {
        el.setSelectionRange(start + openMark.length, start + openMark.length);
      }
    });
  };

  const updateFormatVisibility = () => {
    const el = textareaRef.current;
    if (!el) return;
    const hasSelection = el.selectionEnd - el.selectionStart > 0;
    setShowFormat(hasSelection && !sending);
  };

  /* ---------- 8. Клавиатура ---------- */
  const handleKeyDown = (e) => {
    const isCtrl = e.ctrlKey || e.metaKey;

    if (e.key === "Enter" && isCtrl) {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const value = el.value;
      const newValue = value.slice(0, start) + "\n" + value.slice(end);
      setText(newValue);
      requestAnimationFrame(() => {
        el.setSelectionRange(start + 1, start + 1);
      });
      return;
    }

    if (isCtrl) {
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        applyFormat("**", "**");
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        applyFormat("*", "*");
      } else if (e.key === "u" || e.key === "U") {
        e.preventDefault();
        applyFormat("`", "`");
      }
      return;
    }

    if (e.key === "Enter") {
      if (e.shiftKey) return;
      e.preventDefault();
      handleSend(e);
    }
  };

  /* ---------- 9. Создание чата ---------- */
  const handleCreateChat = async (e) => {
    e.preventDefault();
    if (!newChat.title.trim() || !newChat.description.trim()) return;

    setCreatingChat(true);
    setCreateChatError(null);
    let created;
    try {
      created = await chatsApi.createChat({
        title: newChat.title.trim(),
        description: newChat.description.trim(),
        invited_user_ids: selectedUsers.map((user) => user.id),
        avatar_urls: [],
      });
    } catch (err) {
      const detail = err.response?.data?.detail;
      setCreateChatError(
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((item) => item.msg).filter(Boolean).join("; ")
            : err.message || "Не удалось создать группу",
      );
      setCreatingChat(false);
      return;
    }

    setChats((prev) =>
      prev.some((c) => c.id === created.id) ? prev : [created, ...prev],
    );
    setCreateOpen(false);
    setNewChat({ title: "", description: "" });
    setUsernameQuery("");
    setUserSearchResults([]);
    setSelectedUsers([]);
    setSelectedAvatarFiles([]);
    setCreatingChat(false);

    if (selectedAvatarFiles.length) {
      setUploadingChatAvatars(true);
      setChatAvatarError(null);
      try {
        await chatsApi.uploadChatAvatars(created.id, selectedAvatarFiles);
        const updatedChats = await chatsApi.listChats();
        setChats(updatedChats);
      } catch (error) {
        let errorMessage =
          error.message || "Группа создана, но аватары загрузить не удалось";
        try {
          setChats(await chatsApi.listChats());
        } catch (refreshError) {
          errorMessage += `; не удалось обновить группу: ${refreshError.message}`;
        }
        setChatAvatarError(errorMessage);
      } finally {
        setUploadingChatAvatars(false);
      }
    }
    navigate(`/chats/${created.id}`);
  };

  const handleChatAvatarSelection = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || !chatId) return;

    setChatAvatarError(null);
    setUploadingChatAvatars(true);
    try {
      await chatsApi.uploadChatAvatars(chatId, files);
      const updatedChats = await chatsApi.listChats();
      setChats(updatedChats);
    } catch (error) {
      let errorMessage =
        error.message || "Не удалось загрузить аватары группы";
      try {
        setChats(await chatsApi.listChats());
      } catch (refreshError) {
        errorMessage += `; не удалось обновить группу: ${refreshError.message}`;
      }
      const detail = error.response?.data?.detail;
      setChatAvatarError(
        typeof detail === "string"
          ? detail
          : errorMessage,
      );
    } finally {
      setUploadingChatAvatars(false);
    }
  };

  /* ---------- 10. Реакции (с toggle и user_reaction) ---------- */
  const handleReaction = useCallback(async (messageId, emoji) => {
    try {
      const res = await messagesApi.addReaction(messageId, emoji);
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId) return m;

          const wasMine = m.user_reaction === emoji;
          const nextUserReaction = wasMine ? null : emoji;

          return {
            ...m,
            reactions_count:
              res.updated_reactions_count ?? m.reactions_count,
            user_reaction: nextUserReaction,
          };
        }),
      );
    } catch (err) {
      console.error("Не удалось поставить реакцию:", err);
    }
  }, []);

  const openReactionPicker = useCallback((e, messageId) => {
    e.preventDefault();
    setReactionPicker({
      messageId,
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  const closeReactionPicker = () => setReactionPicker(null);

  const pickReaction = async (emoji) => {
    if (!reactionPicker) return;
    const { messageId } = reactionPicker;
    setReactionPicker(null);
    await handleReaction(messageId, emoji);
  };

  /* ---------- 11. Выбор файлов ---------- */
  const handleFileSelection = (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length) setSelectedFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  };

  /* ---------- 12. Производные ---------- */
  const filtered = useMemo(
    () =>
      chats.filter((c) =>
        (c.title || "").toLowerCase().includes(search.toLowerCase()),
      ),
    [chats, search],
  );

  const activeChat = useMemo(
    () => chats.find((c) => c.id === chatId),
    [chats, chatId],
  );

  const handleContextMenuMessage = useCallback(
    (e, messageId) => openReactionPicker(e, messageId),
    [openReactionPicker],
  );

  /* ============================================================
     Рендер
     ============================================================ */
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
            title="Создать группу"
            onClick={() => {
              setCreateChatError(null);
              setUsernameQuery("");
              setUserSearchResults([]);
              setSelectedUsers([]);
              setSelectedAvatarFiles([]);
              setCreateOpen(true);
            }}
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
                <ChatAvatar chat={c} />
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
        {!chatId ? (
          <div className="chat-view__placeholder">
            <div className="chat-view__placeholder-icon">💬</div>
            <p>Выберите чат слева или создайте новый</p>
          </div>
        ) : !activeChat ? (
          <div className="chat-view__placeholder">
            <div className="chat-view__placeholder-icon">⏳</div>
            <p>Загрузка чата…</p>
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
              <ChatAvatar chat={activeChat} compact />
              <div>
                <div className="chat-view__title">{activeChat.title}</div>
                <div className="chat-view__status">
                  {typingUsers.size > 0
                    ? `${typingUsers.size} печатает…`
                    : activeChat.description || "был(а) недавно"}
                </div>
              </div>
              <label
                className="chat-avatar-upload"
                title="Добавить аватарки группы"
              >
                {uploadingChatAvatars ? "Загрузка…" : "Добавить фото"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  hidden
                  disabled={uploadingChatAvatars}
                  onChange={handleChatAvatarSelection}
                />
              </label>
            </header>

            {chatAvatarError && (
              <p className="chat-create-error" role="alert">
                {chatAvatarError}
              </p>
            )}

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
                messages.map((m) => (
                  <MessageItem
                    key={m.id}
                    message={m}
                    isMe={m.user_id === me?.id}
                    onReaction={handleReaction}
                    onContextMenu={handleContextMenuMessage}
                  />
                ))}
              <div ref={bottomRef} />
            </div>

            {/* ---------- Composer ---------- */}
            <div className="chat-view__composer-wrapper">
              <FormatToolbar onFormat={applyFormat} visible={showFormat} />

              <form className="chat-view__composer" onSubmit={handleSend}>
                <label className="composer-btn" title="Прикрепить">
                  📎
                  <input
                    type="file"
                    multiple
                    hidden
                    disabled={sending}
                    onChange={handleFileSelection}
                  />
                </label>

                <textarea
                  ref={textareaRef}
                  className="composer-input"
                  placeholder="Написать сообщение…"
                  value={text}
                  rows={1}
                  onChange={handleTextChange}
                  onSelect={updateFormatVisibility}
                  onMouseUp={updateFormatVisibility}
                  onKeyUp={updateFormatVisibility}
                  onKeyDown={handleKeyDown}
                  onBlur={() => {
                    blurTimeoutRef.current = setTimeout(
                      () => setShowFormat(false),
                      150,
                    );
                  }}
                  disabled={sending}
                />

                <button
                  type="submit"
                  className="composer-btn composer-btn--send"
                  disabled={
                    sending || (!text.trim() && selectedFiles.length === 0)
                  }
                  title="Отправить"
                >
                  ➤
                </button>
              </form>

              {selectedFiles.length > 0 && (
                <ul className="composer-attachments">
                  {selectedFiles.map((file, index) => (
                    <li
                      className="composer-attachments__item"
                      key={`${file.name}-${file.lastModified}-${index}`}
                    >
                      <span>{file.name}</span>
                      <button
                        type="button"
                        className="composer-attachments__remove"
                        aria-label={`Удалить файл ${file.name}`}
                        disabled={sending}
                        onClick={() =>
                          setSelectedFiles((prev) =>
                            prev.filter((_, i) => i !== index),
                          )
                        }
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </section>

      {/* ---------- Пикер реакций ---------- */}
      {reactionPicker && (
        <>
          <div
            className="reaction-picker__backdrop"
            onClick={closeReactionPicker}
            onContextMenu={(e) => {
              e.preventDefault();
              closeReactionPicker();
            }}
          />
          <div
            className="reaction-picker"
            style={{
              top: Math.max(8, reactionPicker.y - 60),
              left: Math.min(reactionPicker.x, window.innerWidth - 340),
            }}
          >
            {EMOJI_SET.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="reaction-picker__emoji"
                onClick={() => pickReaction(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ---------- Модалка создания группы ---------- */}
      {createOpen && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!creatingChat) setCreateOpen(false);
          }}
        >
          <form
            className="modal chat-create-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateChat}
          >
            <h3>Новая группа</h3>
            <label className="vk-field">
              <span className="vk-field__label">Название</span>
              <input
                type="text"
                value={newChat.title}
                maxLength={50}
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
                maxLength={150}
                onChange={(e) =>
                  setNewChat((p) => ({ ...p, description: e.target.value }))
                }
                required
              />
            </label>
            <label className="vk-field">
              <span className="vk-field__label">Добавить участников по username</span>
              <input
                type="search"
                value={usernameQuery}
                onChange={(event) => setUsernameQuery(event.target.value)}
                placeholder="Введите минимум 2 символа"
                autoComplete="off"
              />
            </label>
            {userSearchLoading && (
              <p className="chat-create-hint">Поиск пользователей…</p>
            )}
            {userSearchError && (
              <p className="chat-create-error" role="alert">
                {userSearchError}
              </p>
            )}
            {userSearchResults.length > 0 && (
              <ul className="chat-user-search-results">
                {userSearchResults.map((user) => (
                  <li key={user.id}>
                    <span>@{user.username}</span>
                    <button
                      type="button"
                      className="vk-btn"
                      onClick={() => {
                        setSelectedUsers((current) => [...current, user]);
                        setUsernameQuery("");
                        setUserSearchResults([]);
                      }}
                    >
                      Добавить
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selectedUsers.length > 0 && (
              <ul className="chat-selected-users">
                {selectedUsers.map((user) => (
                  <li key={user.id}>
                    <span>@{user.username}</span>
                    <button
                      type="button"
                      aria-label={`Убрать @${user.username}`}
                      onClick={() =>
                        setSelectedUsers((current) =>
                          current.filter((selected) => selected.id !== user.id),
                        )
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label className="vk-field">
              <span className="vk-field__label">Аватарки группы</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  event.target.value = "";
                  if (files.length) {
                    setSelectedAvatarFiles((current) => [...current, ...files]);
                  }
                }}
              />
            </label>
            {selectedAvatarFiles.length > 0 && (
              <ul className="chat-selected-avatars">
                {selectedAvatarFiles.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`}>
                    <span>{file.name}</span>
                    <button
                      type="button"
                      aria-label={`Убрать ${file.name}`}
                      onClick={() =>
                        setSelectedAvatarFiles((current) =>
                          current.filter((_, fileIndex) => fileIndex !== index),
                        )
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {createChatError && (
              <p className="chat-create-error" role="alert">
                {createChatError}
              </p>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button
                type="submit"
                className="vk-btn vk-btn--primary"
                disabled={creatingChat || uploadingChatAvatars}
              >
                {creatingChat ? "Создание…" : "Создать группу"}
              </button>
              <button
                type="button"
                className="vk-btn"
                disabled={creatingChat}
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
