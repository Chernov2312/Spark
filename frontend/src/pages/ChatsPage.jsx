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
import AIChatPanel from "../components/AIChatPanel";

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
  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const inline = (value) => {
    let html = escapeHtml(value);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+|#[^\s)]*)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );
    return html
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>")
      .replace(/(^|[\s(])\*([^*\n]+?)\*(?=[\s).,!?]|$)/g, "$1<em>$2</em>")
      .replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,!?]|$)/g, "$1<em>$2</em>");
  };

  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = null;
  let code = null;
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push(`<${list.type}>${list.items.map((item) => `<li>${inline(item)}</li>`).join("")}</${list.type}>`);
    list = null;
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```([\w-]*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      if (code === null) code = [];
      else {
        blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    const item = line.match(/^\s*(?:[-+*])\s+(.+)$/) || line.match(/^\s*\d+[.)]\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (item) {
      flushParagraph();
      const type = /^\s*\d+[.)]\s+/.test(line) ? "ol" : "ul";
      if (list && list.type !== type) flushList();
      if (!list) list = { type, items: [] };
      list.items.push(item[1]);
    } else if (quote) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${inline(quote[1])}</blockquote>`);
    } else if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push("<hr>");
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  if (code !== null) blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
  return blocks.join("");
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
  const latestUrl = urls.at(-1);

  return (
    <div
      className={`chat-item__avatar${compact ? " chat-item__avatar--sm" : ""}`}
      aria-label={`Аватары группы ${chat.title}`}
    >
      {latestUrl ? <img src={latestUrl} alt="" /> : (
        (chat.title?.[0] || "?").toUpperCase()
      )}
    </div>
  );
}

/* ============================================================
   Компонент одного вложения (единый формат)
   ============================================================ */

function formatMediaTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

const AudioPlayer = React.memo(function AudioPlayer({ src, fileName, preview = false }) {
  const audioRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [rateIndex, setRateIndex] = useState(0);
  const playbackRates = [1, 1.25, 1.5, 2];

  const changePlaybackRate = () => {
    const nextIndex = (rateIndex + 1) % playbackRates.length;
    setRateIndex(nextIndex);
    if (audioRef.current) audioRef.current.playbackRate = playbackRates[nextIndex];
  };

  return (
    <div className={`audio-player${preview ? " audio-player--preview" : ""}`}>
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        src={src}
        aria-label={fileName || "Аудиосообщение"}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onEnded={() => setCurrentTime(duration)}
      />
      <span className="audio-player__time" aria-label="Длительность аудио">
        {formatMediaTime(currentTime)} / {formatMediaTime(duration)}
      </span>
      <button
        type="button"
        className="audio-player__speed"
        onClick={changePlaybackRate}
        aria-label={`Скорость воспроизведения ${playbackRates[rateIndex]}x`}
      >
        {playbackRates[rateIndex]}×
      </button>
    </div>
  );
});

const AttachmentItem = React.memo(function AttachmentItem({
  attachment,
  onTranscribe,
  onDownload,
  isTranscribing,
}) {
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const {
    id,
    file_key,
    file_name,
    mime_type,
    text: attachmentText,
    transcription_error: transcriptionError,
  } = attachment;
  const isAudio =
    (typeof mime_type === "string" && mime_type.startsWith("audio/")) ||
    /\.(wav|mp3|ogg|opus|m4a|aac|flac|webm)$/i.test(file_name || "");
  const isText =
    (typeof mime_type === "string" && mime_type.startsWith("text/")) ||
    /\.(txt|md|csv|json|xml|log)$/i.test(file_name || "");
  const isMarkdown = /\.md$/i.test(file_name || "") || mime_type === "text/markdown";
  const fileName = file_name || "Вложение";

  if (!file_key) return null;

  return (
    <div className="msg__attachment" key={id}>
      {isAudio && (
        <AudioPlayer src={file_key} fileName={fileName} />
      )}
      {(isText && !isMarkdown ||
        isAudio ||
        (!isMarkdown && attachmentText !== null && attachmentText !== undefined)) && (
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
              {isTranscribing ? "Распознавание…" : "Распознать речь в текст"}
              {!isTranscribing && (
                <button
                  type="button"
                  className="msg__transcribe-button"
                  onClick={() => onTranscribe(attachment)}
                >
                  Распознать
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {isMarkdown && (
        <div className="markdown-attachment">
          <button
            type="button"
            className="markdown-attachment__toggle"
            onClick={() => setMarkdownOpen((open) => !open)}
            aria-expanded={markdownOpen}
          >
            {markdownOpen ? "Скрыть Markdown" : "Просмотреть Markdown"}
          </button>
          {markdownOpen && (
            attachmentText ? (
              <div
                className="markdown-attachment__content markdown-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(attachmentText) }}
              />
            ) : (
              <div className="markdown-attachment__content markdown-attachment__empty">
                Предпросмотр недоступен. Скачайте файл, чтобы открыть его содержимое.
              </div>
            )
          )}
        </div>
      )}
      <button
        type="button"
        className="msg__attachment-link"
        onClick={() => onDownload(attachment)}
        aria-label={`Скачать ${fileName}`}
      >
        {isAudio ? "Скачать аудио" : fileName}
      </button>
    </div>
  );
});

function isVisualMedia(attachment) {
  return (
    attachment?.mime_type?.startsWith("image/") ||
    attachment?.mime_type?.startsWith("video/")
  );
}

function MediaGrid({ attachments, onOpenMedia }) {
  return (
    <div className={`msg__media-grid msg__media-grid--${Math.min(attachments.length, 4)}`}>
      {attachments.map((attachment) => {
        const isVideo = attachment.mime_type?.startsWith("video/");
        return (
          <button
            key={attachment.id || attachment.file_key}
            type="button"
            className="msg__media-tile"
            onClick={() => onOpenMedia(attachment)}
            aria-label={`Открыть ${attachment.file_name || "вложение"}`}
          >
            {isVideo ? (
              <video src={attachment.file_key} muted preload="metadata" />
            ) : (
              <img
                src={attachment.file_key}
                alt={attachment.file_name || "Изображение"}
                loading="lazy"
              />
            )}
            {isVideo && <span className="msg__media-play" aria-hidden="true">▶</span>}
          </button>
        );
      })}
    </div>
  );
}

function MediaViewer({ attachments, index, onClose, onChange, onDownload }) {
  const attachment = attachments[index];
  const isVideo = attachment?.mime_type?.startsWith("video/");

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onChange(-1);
      if (event.key === "ArrowRight") onChange(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onChange, onClose]);

  if (!attachment) return null;

  return (
    <div
      className="media-viewer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="media-viewer" role="dialog" aria-modal="true" aria-label="Просмотр вложения">
        <header className="media-viewer__header">
          <span className="media-viewer__name">{attachment.file_name}</span>
          <span className="media-viewer__count">{index + 1} / {attachments.length}</span>
          <button
            type="button"
            className="media-viewer__download"
            onClick={() => onDownload(attachment)}
          >
            Скачать оригинал
          </button>
          <button type="button" className="media-viewer__close" onClick={onClose} aria-label="Закрыть просмотр">
            ×
          </button>
        </header>
        <div className="media-viewer__stage">
          {attachments.length > 1 && (
            <button type="button" className="media-viewer__nav" onClick={() => onChange(-1)} aria-label="Предыдущее вложение">
              ‹
            </button>
          )}
          {isVideo ? (
            <video key={attachment.file_key} src={attachment.file_key} controls autoPlay />
          ) : (
            <img src={attachment.file_key} alt={attachment.file_name || "Изображение"} />
          )}
          {attachments.length > 1 && (
            <button type="button" className="media-viewer__nav" onClick={() => onChange(1)} aria-label="Следующее вложение">
              ›
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/* ============================================================
   Компонент одного сообщения
   ============================================================ */

const MessageItem = React.memo(function MessageItem({
  message: m,
  isMe,
  onReaction,
  onContextMenu,
  onTranscribe,
  onDownload,
  transcribingAttachments,
  onOpenMedia,
}) {
  const html = useMemo(() => renderMarkdown(m.text), [m.text]);
  const attachments = Array.isArray(m.attachments) ? m.attachments : [];
  const attachmentGroups = attachments.reduce((groups, attachment) => {
    const media = isVisualMedia(attachment);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup?.media === media) lastGroup.items.push(attachment);
    else groups.push({ media, items: [attachment] });
    return groups;
  }, []);
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
          <div
            className="msg__text"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}

        {attachmentGroups.map((group, groupIndex) =>
          group.media ? (
            <MediaGrid
              key={`media-${groupIndex}`}
              attachments={group.items}
              onOpenMedia={onOpenMedia}
            />
          ) : (
            group.items.map((attachment) => (
              <AttachmentItem
                key={attachment.id || attachment.file_key}
                attachment={attachment}
                onTranscribe={onTranscribe}
                onDownload={onDownload}
                isTranscribing={transcribingAttachments.has(attachment.id)}
              />
            ))
          ),
        )}

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
  const [chatDetailsOpen, setChatDetailsOpen] = useState(true);
  const [aiPanelOpen, setAIPanelOpen] = useState(false);
  const [transcribingAttachments, setTranscribingAttachments] = useState(
    () => new Set(),
  );

  const [search, setSearch] = useState("");
  const [text, setText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedPreviewUrls, setSelectedPreviewUrls] = useState([]);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null);
  const [recordingError, setRecordingError] = useState(null);
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
  const [galleryIndex, setGalleryIndex] = useState(null);

  const bottomRef = useRef(null);
  const socketRef = useRef(null);
  const socketOpenRef = useRef(false);
  const typingSentAtRef = useRef(0);
  const typingUsersTimeoutsRef = useRef(new Map());
  const textareaRef = useRef(null);
  const sendingRef = useRef(false);
  const blurTimeoutRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  useEffect(() => {
    const previews = selectedFiles.map((file) =>
      file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    );
    setSelectedPreviewUrls(previews);
    return () => previews.forEach((url) => url && URL.revokeObjectURL(url));
  }, [selectedFiles]);

  useEffect(() => {
    if (!recordedAudio) {
      setRecordedAudioUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(recordedAudio);
    setRecordedAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recordedAudio]);

  useEffect(() => {
    const timerRef = recordingTimerRef;
    const streamRef = recordingStreamRef;
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

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
    setAIPanelOpen(false);
    setRecordedAudio(null);
    setGalleryIndex(null);
    setRecording(false);
    recordingChunksRef.current = [];
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    if (mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current?.stop();
    }
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
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
            setTranscribingAttachments((previous) => {
              const next = new Set(previous);
              next.delete(data.attachment_id);
              return next;
            });
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

    const typingTimeouts = typingUsersTimeoutsRef.current;
    return () => {
      sock?.close();
      if (socketRef.current === sock) socketRef.current = null;
      socketOpenRef.current = false;

      typingTimeouts.forEach((t) => clearTimeout(t));
      typingTimeouts.clear();
      setTypingUsers(new Set());
    };
    // me?.id намеренно не в зависимостях: сокет пересоздаётся только при смене чата
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  /* ---------- 4. Скролл вниз ---------- */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startVoiceRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setRecordingError("Запись аудио не поддерживается этим браузером.");
      return;
    }
    try {
      setRecordingError(null);
      setRecordingSeconds(0);
      recordingChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const mimeType =
        typeof MediaRecorder.isTypeSupported === "function"
          ? ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm"].find(
              (type) => MediaRecorder.isTypeSupported(type),
            )
          : null;
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) recordingChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
        const chunks = recordingChunksRef.current;
        recordingChunksRef.current = [];
        setRecording(false);
        if (!chunks.length) return;
        const contentType = recorder.mimeType || "audio/webm";
        const extension = contentType.includes("ogg") ? "ogg" : "webm";
        setRecordedAudio(
          new File(chunks, `voice-${Date.now()}.${extension}`, {
            type: contentType,
          }),
        );
      };
      recorder.start();
      setRecording(true);
      recordingTimerRef.current = setInterval(
        () => setRecordingSeconds((seconds) => seconds + 1),
        1000,
      );
    } catch (error) {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      setRecording(false);
      setRecordingError(
        error.name === "NotAllowedError"
          ? "Разрешите доступ к микрофону, чтобы записать голосовое сообщение."
          : "Не удалось начать запись аудио.",
      );
    }
  }, []);

  const stopVoiceRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const cancelVoiceRecording = () => {
    recordingChunksRef.current = [];
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    recordingTimerRef.current = null;
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      setRecording(false);
    }
    setRecordedAudio(null);
    setRecordingSeconds(0);
  };

  const attachRecordedAudio = () => {
    if (!recordedAudio) return;
    if (selectedFiles.length >= 10) {
      setMessagesError("В одном сообщении можно отправить не больше 10 вложений.");
      return;
    }
    setMessagesError(null);
    setSelectedFiles((previous) => [...previous, recordedAudio]);
    setRecordedAudio(null);
    setRecordingSeconds(0);
  };

  /* ---------- 5. Отправка сообщения ---------- */
  const handleSend = useCallback(
    async (e) => {
      if (e) e.preventDefault();
      if (sendingRef.current) return;
      const filesToSend = recordedAudio
        ? [...selectedFiles, recordedAudio]
        : selectedFiles;
      if ((!text.trim() && filesToSend.length === 0) || !chatId) return;
      if (filesToSend.length > 10) {
        setMessagesError("В одном сообщении можно отправить не больше 10 вложений.");
        return;
      }

      sendingRef.current = true;
      setSending(true);
      setMessagesError(null);

      try {
        // 1) Загружаем файлы — каждый ответ в едином формате AttachmentResponse
        const uploaded = await Promise.all(
          filesToSend.map(async (file) => {
            const isText =
              file.type.startsWith("text/") ||
              /\.(txt|md|csv|json|xml|log)$/i.test(file.name);
            const fileText = isText ? await file.text() : null;
            return {
              ...(await attachmentsApi.uploadAttachment(file, chatId, {
                compressImages: true,
              })),
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
        setRecordedAudio(null);
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
    [chatId, recordedAudio, selectedFiles, text],
  );

  const handleTranscribe = useCallback(
    async (message, attachment) => {
      if (
        !chatId ||
        !attachment.id ||
        transcribingAttachments.has(attachment.id)
      )
        return;
      setTranscribingAttachments((previous) =>
        new Set(previous).add(attachment.id),
      );
      try {
        const result = await messagesApi.transcribeAttachment(
          chatId,
          message.id,
          attachment.id,
        );
        if (!result.queued) {
          setTranscribingAttachments((previous) => {
            const next = new Set(previous);
            next.delete(attachment.id);
            return next;
          });
        }
      } catch (error) {
        setMessagesError(
          translateApiError(error, "Не удалось запустить распознавание аудио"),
        );
        setTranscribingAttachments((previous) => {
          const next = new Set(previous);
          next.delete(attachment.id);
          return next;
        });
      }
    },
    [chatId, transcribingAttachments],
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
    if (files.length) {
      if (selectedFiles.length + files.length > 10) {
        setMessagesError("В одном сообщении можно отправить не больше 10 вложений.");
      } else {
        setMessagesError(null);
        setSelectedFiles((previous) => [...previous, ...files]);
      }
    }
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

  useEffect(() => {
    setChatDetailsOpen(true);
  }, [chatId]);

  const galleryAttachments = useMemo(
    () =>
      messages.flatMap((message) => message.attachments || []).filter(isVisualMedia),
    [messages],
  );
  const openMediaViewer = useCallback(
    (attachment) => {
      const index = galleryAttachments.findIndex(
        (item) => item.id === attachment.id || item.file_key === attachment.file_key,
      );
      if (index >= 0) setGalleryIndex(index);
    },
    [galleryAttachments],
  );
  const closeMediaViewer = useCallback(() => setGalleryIndex(null), []);
  const downloadMedia = useCallback(
    async (attachment) => {
      try {
        const url = await attachmentsApi.getAttachmentDownloadUrl(attachment.id);
        window.location.assign(url);
      } catch (error) {
        setMessagesError(
          translateApiError(error, "Не удалось скачать вложение"),
        );
      }
    },
    [],
  );
  const moveMediaViewer = useCallback(
    (offset) => {
      setGalleryIndex((index) =>
        index === null || !galleryAttachments.length
          ? null
          : (index + offset + galleryAttachments.length) % galleryAttachments.length,
      );
    },
    [galleryAttachments.length],
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
              <button
                type="button"
                className="ai-panel__toggle"
                onClick={() => setAIPanelOpen((open) => !open)}
                aria-expanded={aiPanelOpen}
                aria-label={aiPanelOpen ? "Закрыть ИИ-помощника" : "Открыть ИИ-помощника"}
              >
                ✨ ИИ
              </button>
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

            <section className="chat-details" aria-label="Информация о чате">
              <div className="chat-details__heading">
                <div>
                  <h2>О чате</h2>
                  <p>{activeChat.description || "Описание пока не добавлено."}</p>
                </div>
                <button
                  type="button"
                  className="chat-details__toggle"
                  onClick={() => setChatDetailsOpen((open) => !open)}
                  aria-expanded={chatDetailsOpen}
                >
                  {chatDetailsOpen ? "Свернуть" : "Подробнее"}
                </button>
              </div>
              {chatDetailsOpen && (
                <>
                  <div className="chat-details__meta">
                    <span>{messages.length} сообщений загружено</span>
                    {activeChat.created_at && (
                      <span>
                        Создан {new Date(activeChat.created_at).toLocaleDateString("ru-RU")}
                      </span>
                    )}
                  </div>
                  <div className="chat-photo-feed" aria-label="Лента изображений">
                    <h3>Изображения и видео</h3>
                    {galleryAttachments.length ? (
                      <div className="chat-photo-feed__items">
                        {[...galleryAttachments].reverse().map((attachment) => (
                          <button
                            key={attachment.id || attachment.file_key}
                            type="button"
                            className="chat-photo-feed__item"
                            onClick={() => openMediaViewer(attachment)}
                            aria-label={`Открыть ${attachment.file_name || "изображение"}`}
                          >
                            {attachment.mime_type?.startsWith("video/") ? (
                              <video src={attachment.file_key} muted preload="metadata" />
                            ) : (
                              <img src={attachment.file_key} alt={attachment.file_name || ""} loading="lazy" />
                            )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="chat-photo-feed__empty">В этом чате пока нет изображений.</p>
                    )}
                  </div>
                </>
              )}
            </section>

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
                    onTranscribe={(attachment) => handleTranscribe(m, attachment)}
                    onDownload={downloadMedia}
                    transcribingAttachments={transcribingAttachments}
                    onOpenMedia={openMediaViewer}
                  />
                ))}
              <div ref={bottomRef} />
            </div>

            {/* ---------- Composer ---------- */}
            <div className="chat-view__composer-wrapper">
              <FormatToolbar onFormat={applyFormat} visible={showFormat} />

              <form className="chat-view__composer" onSubmit={handleSend}>
                {recording ? (
                  <>
                    <span className="voice-recording__timer" aria-live="polite">
                      <span className="voice-recording__dot" />
                      Запись {formatMediaTime(recordingSeconds)}
                    </span>
                    <button
                      type="button"
                      className="composer-btn voice-recording__stop"
                      onClick={stopVoiceRecording}
                      title="Завершить запись и прослушать"
                      aria-label="Завершить запись"
                    >
                      ■
                    </button>
                    <button
                      type="button"
                      className="composer-btn"
                      onClick={cancelVoiceRecording}
                      title="Отменить запись"
                      aria-label="Отменить запись"
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="composer-btn"
                    onClick={startVoiceRecording}
                    disabled={sending || Boolean(recordedAudio)}
                    title="Записать голосовое сообщение"
                    aria-label="Записать голосовое сообщение"
                  >
                    🎙
                  </button>
                )}
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
                    sending ||
                    (!text.trim() && selectedFiles.length === 0 && !recordedAudio)
                  }
                  title="Отправить"
                >
                  ➤
                </button>
              </form>

              {recordingError && (
                <p className="voice-recording__error" role="alert">
                  {recordingError}
                </p>
              )}

              {recordedAudio && recordedAudioUrl && (
                <div className="voice-preview">
                  <div className="voice-preview__heading">Предпрослушивание голосового сообщения</div>
                  <AudioPlayer src={recordedAudioUrl} fileName={recordedAudio.name} preview />
                  <div className="voice-preview__actions">
                    <button type="button" onClick={attachRecordedAudio} disabled={sending}>
                      Прикрепить к сообщению
                    </button>
                    <button type="button" onClick={cancelVoiceRecording} disabled={sending}>
                      Удалить запись
                    </button>
                  </div>
                </div>
              )}

              {selectedFiles.length > 0 && (
                <>
                  {selectedFiles.filter((file) => file.type.startsWith("image/")).length > 1 && (
                    <p className="composer-attachments__album-hint">
                      Альбом: фотографии отправятся одним сообщением.
                    </p>
                  )}
                  <ul className="composer-attachments">
                  {selectedFiles.map((file, index) => (
                    <li
                      className="composer-attachments__item"
                      key={`${file.name}-${file.lastModified}-${index}`}
                    >
                      {selectedPreviewUrls[index] ? (
                        <img
                          className="composer-attachments__preview"
                          src={selectedPreviewUrls[index]}
                          alt={file.name}
                        />
                      ) : null}
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
                </>
              )}
            </div>
            {aiPanelOpen && (
              <AIChatPanel
                key={chatId}
                chatId={chatId}
                onClose={() => setAIPanelOpen(false)}
              />
            )}
          </>
        )}
      </section>

      {galleryIndex !== null && (
        <MediaViewer
          attachments={galleryAttachments}
          index={galleryIndex}
          onClose={closeMediaViewer}
          onChange={moveMediaViewer}
          onDownload={downloadMedia}
        />
      )}

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
