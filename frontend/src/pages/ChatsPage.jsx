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
import CallPanel from "../components/CallPanel";
import SocialSidebar from "../components/SocialSidebar";
import { messageTimestamp } from "../utils/messagePreview";

/* ============================================================
   Утилиты времени
   ============================================================ */

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
  if (chat?.personal_avatar_url) return [chat.personal_avatar_url];
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
  onReply,
  onJumpTo,
  readBy,
}) {
  const swipeStartRef = useRef(null);
  const [swipeOffset, setSwipeOffset] = useState(0);
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
      id={`message-${m.id}`}
      className={`msg ${isMe ? "msg--me" : ""}`}
      onContextMenu={(e) => onContextMenu(e, m.id)}
      style={{ transform: swipeOffset ? `translateX(${swipeOffset}px)` : undefined }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" || event.target.closest("button, a, input, video, audio")) return;
        swipeStartRef.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        const start = swipeStartRef.current;
        if (!start) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
          swipeStartRef.current = null;
          setSwipeOffset(0);
        } else if (Math.abs(dx) > 12) setSwipeOffset(Math.max(-80, Math.min(80, dx)));
      }}
      onPointerUp={(event) => {
        const start = swipeStartRef.current;
        if (start && Math.abs(event.clientX - start.x) >= 60 && Math.abs(event.clientY - start.y) < 35) onReply(m);
        swipeStartRef.current = null;
        setSwipeOffset(0);
      }}
      onPointerCancel={() => { swipeStartRef.current = null; setSwipeOffset(0); }}
      title="Правый клик — действия с сообщением"
    >
      {!isMe && (
        <div className="msg__author">
          {m.user_name || (m.user_id ? `@${String(m.user_id).slice(0, 6)}` : "")}
        </div>
      )}
      <div className="msg__bubble">
        {m.reply_to_id && (
          <button type="button" className="msg__reply-quote" onClick={() => onJumpTo(m.reply_to_id)}>
            {m.reply_to_text || "Исходное сообщение"}
          </button>
        )}
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

        <span className="msg__time">{msgTime(m.created_at)}{m.edited_at ? " · изменено" : ""}{readBy ? " · прочитано" : ""}</span>
      </div>

      <div className="msg__actions">
        <button type="button" onClick={() => onReply(m)} aria-label="Ответить">↩</button>
        {m.is_pinned && <span className="msg__pin-label">Закреплено</span>}
        <button type="button" aria-label="Действия с сообщением" onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          onContextMenu({ preventDefault() {}, clientX: bounds.left, clientY: bounds.bottom }, m.id);
        }}>⋯</button>
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
  const chatPreviewRevisionRef = useRef(0);
  const updateChatPreview = useCallback((targetChatId, message, edited = false) => {
    chatPreviewRevisionRef.current += 1;
    setChats((items) => items.map((chat) => {
      if (chat.id !== targetChatId) return chat;
      if (edited && chat.last_message?.id !== message.id) return chat;
      if (!edited && messageTimestamp(message.created_at) < messageTimestamp(chat.last_message?.created_at)) return chat;
      return { ...chat, last_message: message };
    }));
  }, []);
  const refreshChatPreviews = useCallback(async () => {
    const revision = ++chatPreviewRevisionRef.current;
    try {
      const refreshed = await chatsApi.listChats();
      if (revision !== chatPreviewRevisionRef.current) return;
      const byId = new Map(refreshed.map((chat) => [chat.id, chat.last_message || null]));
      setChats((items) => items.map((chat) => byId.has(chat.id) ? { ...chat, last_message: byId.get(chat.id) } : chat));
    } catch (error) { setMessagesError(translateApiError(error, "Не удалось обновить последнее сообщение")); }
  }, []);
  const [messages, setMessages] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState("");
  const [threadsVersion, refreshThreads] = useReducer((version) => version + 1, 0);
  const [sidebarMode, setSidebarMode] = useState("chats");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [forwarding, setForwarding] = useState(null);
  const [forwardTarget, setForwardTarget] = useState("");
  const [forwardBusy, setForwardBusy] = useState(false);
  const [forwardError, setForwardError] = useState("");
  const activeThreadRef = useRef(null);
  activeThreadRef.current = activeThread;
  const threadRequestRef = useRef(0);
  useEffect(() => {
    if (!chatId) return;
    let cancelled = false;
    setThreadsLoading(true);
    setThreadsError("");
    messagesApi.listThreads(chatId).then((loaded) => {
      if (!cancelled) setThreads(loaded);
    }).catch((error) => {
      if (!cancelled) setThreadsError(translateApiError(error, "Не удалось загрузить треды"));
    }).finally(() => { if (!cancelled) setThreadsLoading(false); });
    return () => { cancelled = true; };
  }, [chatId, threadsVersion]);
  const threadSeenIdsRef = useRef(new Set());
  useEffect(() => {
    setActiveThread(null);
    setThreadMessages([]);
    setThreads([]);
    setThreadLoading(false);
    setForwarding(null);
    threadRequestRef.current += 1;
    threadSeenIdsRef.current.clear();
  }, [chatId]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState(null);
  const [chatDetailsOpen, setChatDetailsOpen] = useState(true);
  const [callPanelOpen, setCallPanelOpen] = useState(false);
  const [activeChatTab, setActiveChatTab] = useState("messages");
  const [aiPanelOpen, setAIPanelOpen] = useState(false);
  const [transcribingAttachments, setTranscribingAttachments] = useState(
    () => new Set(),
  );

  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [searchText, setSearchText] = useState("");
  const [attachmentFilter, setAttachmentFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");
  const [sinceFilter, setSinceFilter] = useState("");
  const [untilFilter, setUntilFilter] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const sendHoldTimerRef = useRef(null);
  const sendHeldRef = useRef(false);
  const messageMenuRef = useRef(null);
  const [chatPrefs, setChatPrefs] = useState({ color: "", background: "", muted: false, sound: true, shareReads: true, sharePresence: true });
  const [chatMembers, setChatMembers] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [selectedPreviewUrls, setSelectedPreviewUrls] = useState([]);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudio, setRecordedAudio] = useState(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState(null);
  const [recordingError, setRecordingError] = useState(null);
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState(new Set());
  const [onlineUsers, setOnlineUsers] = useState(new Set());
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
  const [personalAvatarBusy, setPersonalAvatarBusy] = useState(false);
  const [personalAvatarError, setPersonalAvatarError] = useState("");

  const [showFormat, setShowFormat] = useState(false);
  const [reactionPicker, setReactionPicker] = useState(null);
  useEffect(() => {
    if (!reactionPicker) return;
    const menu = messageMenuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(reactionPicker.x, window.innerWidth - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(reactionPicker.y, window.innerHeight - bounds.height - 8))}px`;
    menu.querySelector("button")?.focus();
    const dismiss = (event) => {
      if (event.key === "Escape") setReactionPicker(null);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [reactionPicker]);
  useEffect(() => () => clearTimeout(sendHoldTimerRef.current), []);
  const [galleryIndex, setGalleryIndex] = useState(null);

  const bottomRef = useRef(null);
  const messageScrollRef = useRef(null);
  const followMessagesRef = useRef(true);
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

  useEffect(() => {
    if (!chatId) return;
    try {
      setChatPrefs({ color: "", background: "", muted: false, sound: true, shareReads: true, sharePresence: true, ...JSON.parse(localStorage.getItem(`chat-prefs:${chatId}`) || "{}") });
    } catch { setChatPrefs({ color: "", background: "", muted: false, sound: true, shareReads: true, sharePresence: true }); }
  }, [chatId]);

  useEffect(() => {
    if (chatId) localStorage.setItem(`chat-draft:${chatId}`, text);
  }, [chatId, text]);

  useEffect(() => {
    if (chatId) localStorage.setItem(`chat-prefs:${chatId}`, JSON.stringify(chatPrefs));
  }, [chatId, chatPrefs]);

  useEffect(() => {
    if (!chatId || !messages.length || !chatPrefs.shareReads) return;
    chatsApi.markChatRead?.(chatId, messages.at(-1)?.id)?.catch(() => {});
  }, [chatId, messages, chatPrefs.shareReads]);

  useEffect(() => {
    if (!chatId) return;
    Promise.resolve(chatsApi.getChatMembers?.(chatId)).then((rows) => setChatMembers(rows || [])).catch(() => setChatMembers([]));
  }, [chatId]);

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
    setText(chatId ? localStorage.getItem(`chat-draft:${chatId}`) || "" : "");
    setReplyTo(null);
    setSelectedFiles([]);
    setAIPanelOpen(false);
    setActiveChatTab("messages");
    setPersonalAvatarError("");
    setSearchOpen(false);
    setScheduleOpen(false);
    setScheduledAt("");
    setReactionPicker(null);
    followMessagesRef.current = true;
    clearTimeout(sendHoldTimerRef.current);
    sendHeldRef.current = false;
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
        sharePresence: chatPrefs.sharePresence,
        onOpen: () => {
          socketOpenRef.current = true;
          const key = `unsent-messages:${chatId}`;
          const pending = JSON.parse(localStorage.getItem(key) || "[]");
          Promise.all(pending.map((item) => messagesApi.sendMessage(chatId, {
            text: item.text,
            reply_to_id: item.reply_to_id,
            thread_root_id: item.thread_root_id,
          }).then(() => null).catch(() => item)))
            .then((results) => {
              const failed = results.filter(Boolean);
              if (failed.length) localStorage.setItem(key, JSON.stringify(failed));
              else localStorage.removeItem(key);
            });
          console.info("[WS] Подключён к чату", chatId);
        },
        onEvent: (event, data) => {
          const mentionsMe = Boolean(me?.tag) && String(data.text || "").toLowerCase().includes(`@${me.tag.toLowerCase()}`);
          if (event === "message:new" && data.chat_id === chatId) {
            if (data.thread_root_id) {
              const isNewThreadReply = !threadSeenIdsRef.current.has(data.id);
              threadSeenIdsRef.current.add(data.id);
              if (isNewThreadReply) setMessages((prev) => prev.map((item) => item.id === data.thread_root_id
                ? { ...item, thread_reply_count: (item.thread_reply_count || 0) + 1 }
                : item));
              refreshThreads();
              setThreadMessages((prev) => activeThreadRef.current?.id === data.thread_root_id && !prev.some((m) => m.id === data.id)
                ? [...prev, data]
                : prev);
            } else {
              setMessages((prev) => {
                const exists = prev.some((m) => m.id === data.id);
                if (exists) return prev;
                return [...prev, data];
              });
            }
            updateChatPreview(chatId, data);
            if (!chatPrefs.muted && data.user_id !== me?.id && chatPrefs.sound && typeof AudioContext !== "undefined") {
              try {
                const audio = new AudioContext();
                const tone = audio.createOscillator();
                const gain = audio.createGain();
                tone.connect(gain); gain.connect(audio.destination);
                gain.gain.value = 0.035; tone.frequency.value = 660;
                tone.start(); tone.stop(audio.currentTime + 0.1);
                tone.onended = () => audio.close();
              } catch {}
            }
            if (!chatPrefs.muted && data.user_id !== me?.id && !mentionsMe && typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification("Новое сообщение", { body: data.text || "Вложение", tag: `chat-${chatId}` });
            }
          }

          if (mentionsMe && !chatPrefs.muted && typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("Вас упомянули", { body: data.text, tag: `mention-${chatId}` });
          }
          if (event === "message:updated" && data.chat_id === chatId) {
            updateChatPreview(chatId, data, true);
            setMessages((prev) => prev.map((item) => item.id === data.id ? { ...item, ...data } : item));
            setThreadMessages((prev) => prev.map((item) => item.id === data.id ? { ...item, ...data } : item));
          }
          if (event === "message:deleted" && data.chat_id === chatId) {
            refreshChatPreviews();
            setMessages((prev) => prev.filter((item) => item.id !== data.message_id));
            setThreadMessages((prev) => prev.filter((item) => item.id !== data.message_id));
            refreshThreads();
            if (activeThreadRef.current?.id === data.message_id) setActiveThread(null);
          }
          if (event === "user:presence" && data.chat_id === chatId) {
            setOnlineUsers((previous) => {
              const next = new Set(previous);
              if (data.online) next.add(data.user_id); else next.delete(data.user_id);
              return next;
            });
          }
          if (event === "user:read" && data.chat_id === chatId) {
            setChatMembers((previous) => previous.map((member) => member.id === data.user_id ? { ...member, last_read_message_id: data.last_read_message_id } : member));
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
                      avatar_url: data.avatar_url ?? getChatAvatarUrls(c).at(-1),
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
  }, [chatId, chatPrefs.sharePresence]);

  /* ---------- 4. Скролл вниз ---------- */
  useEffect(() => {
    const container = messageScrollRef.current;
    if (container && followMessagesRef.current) container.scrollTop = container.scrollHeight;
  }, [messages, threadMessages, activeThread]);

  const startVoiceRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setRecordingError("Запись аудио не поддерживается этим браузером.");
      return;
    }
    try {
      setRecordingError(null);
      setRecordingSeconds(0);
      recordingChunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
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

      if (scheduleOpen && (!Number.isFinite(Date.parse(scheduledAt)) || Date.parse(scheduledAt) <= Date.now())) {
        setMessagesError("Выберите время отправки в будущем.");
        return;
      }
      if (scheduleOpen && scheduledAt) {
        if (filesToSend.length) {
          setMessagesError("Отложенная отправка пока поддерживает только текст.");
          return;
        }
        const queue = JSON.parse(localStorage.getItem("scheduled-messages") || "[]");
        queue.push({ chatId, text: text.trim(), reply_to_id: replyTo?.id || null, thread_root_id: activeThread?.id || null, at: new Date(scheduledAt).toISOString() });
        localStorage.setItem("scheduled-messages", JSON.stringify(queue));
        setText(""); setReplyTo(null); setScheduledAt(""); setScheduleOpen(false);
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
          reply_to_id: replyTo?.id || null,
          thread_root_id: activeThread?.id || null,
        });

        // 4) Мержим в список по id (защита от дубля с WS)
        if (activeThread) {
          refreshThreads();
          const isNewThreadReply = !threadSeenIdsRef.current.has(created.id);
          threadSeenIdsRef.current.add(created.id);
          setThreadMessages((prev) => prev.some((m) => m.id === created.id) ? prev : [...prev, created]);
          if (isNewThreadReply) setMessages((prev) => prev.map((item) => item.id === activeThread.id
            ? { ...item, thread_reply_count: (item.thread_reply_count || 0) + 1 }
            : item));
        } else setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === created.id);
          if (idx === -1) return [...prev, created];
          const next = [...prev];
          next[idx] = { ...next[idx], ...created };
          return next;
        });

        updateChatPreview(chatId, created);

        setText("");
        setReplyTo(null);
        setSelectedFiles([]);
        setRecordedAudio(null);
        setShowFormat(false);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      } catch (err) {
        const pendingKey = `unsent-messages:${chatId}`;
        const pending = JSON.parse(localStorage.getItem(pendingKey) || "[]");
        pending.push({
          text: text.trim(),
          reply_to_id: replyTo?.id || null,
          thread_root_id: activeThread?.id || null,
        });
        localStorage.setItem(pendingKey, JSON.stringify(pending));
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
    [chatId, recordedAudio, selectedFiles, text, replyTo, scheduledAt, scheduleOpen, activeThread, updateChatPreview],
  );

  useEffect(() => {
    const timer = setInterval(async () => {
      const queue = JSON.parse(localStorage.getItem("scheduled-messages") || "[]");
      const due = queue.filter((item) => Date.parse(item.at) <= Date.now());
      if (!due.length) return;
      const remaining = queue.filter((item) => Date.parse(item.at) > Date.now());
      for (const item of due) {
        try { await messagesApi.sendMessage(item.chatId, { text: item.text, reply_to_id: item.reply_to_id, thread_root_id: item.thread_root_id }); }
        catch { remaining.push(item); }
      }
      localStorage.setItem("scheduled-messages", JSON.stringify(remaining));
    }, 10000);
    return () => clearInterval(timer);
  }, []);

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

  const changePersonalAvatar = async (file) => {
    if (personalAvatarBusy || !chatId) return;
    const targetChatId = chatId;
    setPersonalAvatarBusy(true);
    setPersonalAvatarError("");
    try {
      const result = file
        ? await chatsApi.setPersonalChatAvatar(targetChatId, file)
        : await chatsApi.resetPersonalChatAvatar(targetChatId);
      setChats((items) => items.map((chat) => chat.id === targetChatId
        ? { ...chat, personal_avatar_url: result.personal_avatar_url } : chat));
    } catch (error) {
      setPersonalAvatarError(translateApiError(error, error.message || "Не удалось изменить картинку чата"));
    } finally { setPersonalAvatarBusy(false); }
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
  const activeChat = useMemo(
    () => chats.find((c) => c.id === chatId),
    [chats, chatId],
  );
  const mentionQuery = text.match(/(?:^|\s)@([^\s]*)$/)?.[1];
  const mentionSuggestions = mentionQuery === undefined ? [] : chatMembers.filter((member) => member.id !== me?.id && (member.tag || member.username).toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 5);

  useEffect(() => {
    setChatDetailsOpen(true);
  }, [chatId]);

  const galleryAttachments = useMemo(
    () =>
      (activeThread ? threadMessages : messages).flatMap((message) => message.attachments || []).filter(isVisualMedia),
    [messages, threadMessages, activeThread],
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
  const menuMessage = reactionPicker
    ? [...messages, ...threadMessages].find((message) => message.id === reactionPicker.messageId)
    : null;
  const runMenuAction = (action) => {
    setReactionPicker(null);
    action();
  };

  const replyToMessage = useCallback((message) => {
    setReplyTo(message);
    textareaRef.current?.focus();
  }, []);
  const openThread = useCallback(async (message) => {
    const rootId = message.thread_root_id || message.id;
    const root = threads.find((item) => item.id === rootId) || message;
    const requestId = ++threadRequestRef.current;
    setActiveThread({ ...root, id: rootId });
    setThreadMessages([]);
    setSidebarMode("threads");
    setActiveChatTab("messages");
    setReplyTo(null);
    followMessagesRef.current = true;
    setThreadLoading(true);
    try {
      const loaded = await messagesApi.listThreadMessages(chatId, rootId);
      if (requestId !== threadRequestRef.current) return;
      threadSeenIdsRef.current = new Set(loaded.map((item) => item.id));
      setThreadMessages(loaded);
    } catch (error) {
      if (requestId === threadRequestRef.current) setMessagesError(translateApiError(error, "Не удалось загрузить тред"));
    } finally {
      if (requestId === threadRequestRef.current) setThreadLoading(false);
    }
  }, [chatId, threads]);
  const closeThread = () => {
    threadRequestRef.current += 1;
    setActiveThread(null);
    setThreadMessages([]);
    setReplyTo(null);
    followMessagesRef.current = true;
  };
  const handleForward = async (event) => {
    event.preventDefault();
    if (!forwarding || !forwardTarget || forwardBusy) return;
    setForwardBusy(true);
    setForwardError("");
    try {
      const created = await messagesApi.forwardMessage(chatId, forwarding.id, forwardTarget);
      if (forwardTarget === chatId) setMessages((items) => items.some((item) => item.id === created.id) ? items : [...items, created]);
      updateChatPreview(forwardTarget, created);
      setForwarding(null);
    } catch (error) { setForwardError(translateApiError(error, "Не удалось переслать сообщение")); }
    finally { setForwardBusy(false); }
  };
  const editMessage = useCallback(async (message) => {
    const nextText = window.prompt("Изменить сообщение", message.text || "");
    if (nextText === null || nextText.trim() === "") return;
    try {
      const updated = await messagesApi.updateMessage(message.id, nextText.trim());
      updateChatPreview(updated.chat_id || chatId, updated, true);
      setMessages((previous) => previous.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      setThreadMessages((previous) => previous.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      refreshThreads();
    } catch (error) { setMessagesError(translateApiError(error, "Не удалось изменить сообщение")); }
  }, [chatId, updateChatPreview]);
  const removeMessage = useCallback(async (messageId) => {
    if (!window.confirm("Удалить это сообщение?")) return;
    try {
      await messagesApi.deleteMessage(messageId);
      refreshChatPreviews();
      setMessages((previous) => previous.filter((item) => item.id !== messageId));
      setThreadMessages((previous) => previous.filter((item) => item.id !== messageId));
      if (activeThreadRef.current?.id === messageId) setActiveThread(null);
      refreshThreads();
    }
    catch (error) { setMessagesError(translateApiError(error, "Не удалось удалить сообщение")); }
  }, [refreshChatPreviews]);
  const pinMessage = useCallback(async (message) => {
    try {
      const pinned = await messagesApi.togglePin(chatId, message.id);
      setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, is_pinned: pinned } : item));
      setThreadMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, is_pinned: pinned } : item));
    } catch (error) { setMessagesError(translateApiError(error, "Не удалось закрепить сообщение")); }
  }, [chatId]);
  const jumpToMessage = useCallback((id) => {
    const node = document.getElementById(`message-${id}`);
    const container = messageScrollRef.current;
    if (node && container) container.scrollTop += node.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientHeight / 2;
  }, []);
  const runMessageSearch = useCallback(async (event) => {
    event?.preventDefault();
    if (!chatId) return;
    if (!searchText && !attachmentFilter && !authorFilter && !sinceFilter && !untilFilter) { setSearching(false); messagesApi.listMessages(chatId).then((list) => setMessages([...list].reverse())); return; }
    setSearchBusy(true);
    try {
      const found = await messagesApi.searchMessages(chatId, { text: searchText || undefined, attachment_type: attachmentFilter || undefined, author_id: authorFilter || undefined, since: sinceFilter || undefined, until: untilFilter || undefined });
      setMessages([...found].reverse()); setSearching(true);
    } catch (error) { setMessagesError(translateApiError(error, "Не удалось найти сообщения")); }
    finally { setSearchBusy(false); }
  }, [chatId, searchText, attachmentFilter, authorFilter, sinceFilter, untilFilter]);
  const resetMessageSearch = async () => {
    setSearchText(""); setAttachmentFilter(""); setAuthorFilter(""); setSinceFilter(""); setUntilFilter(""); setSearching(false);
    try { setMessages([...(await messagesApi.listMessages(chatId))].reverse()); }
    catch (error) { setMessagesError(translateApiError(error, "Не удалось восстановить переписку")); }
  };

  /* ============================================================
     Рендер
     ============================================================ */
  return (
    <main className="chats-page">
      {/* ---------- Левая колонка ---------- */}
      <SocialSidebar
        threads={activeThread && !threads.some((thread) => thread.id === activeThread.id) ? [activeThread, ...threads] : threads}
        threadsLoading={threadsLoading}
        threadsError={threadsError}
        activeThreadId={activeThread?.id}
        onOpenThread={openThread}
        mode={sidebarMode}
        onModeChange={(mode) => { setSidebarMode(mode); if (mode === "chats") closeThread(); }}
        mobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
        chats={chats}
        chatsLoading={chatsLoading}
        chatsError={chatsError}
        chatId={chatId}
        navigate={(path) => { closeThread(); setSidebarOpen(false); navigate(path); }}
        onCreateChat={() => {
          setCreateChatError(null);
          setUsernameQuery("");
          setUserSearchResults([]);
          setSelectedUsers([]);
          setSelectedAvatarFiles([]);
          setCreateOpen(true);
        }}
      />

      {/* ---------- Правая колонка ---------- */}
      <section className={`chat-view ${!chatId ? "chat-view--empty" : ""}`} style={{ "--chat-accent": chatPrefs.color || undefined, background: chatPrefs.background || undefined }}>
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
              <button type="button" className="chat-sidebar-toggle" aria-label="Чаты и треды" onClick={() => setSidebarOpen(true)}>☰</button>
              <button
                className="chat-view__back"
                type="button"
                onClick={() => navigate("/chats")}
                title="Назад"
              >
                ←
              </button>
              <button type="button" className="chat-profile-trigger chat-profile-trigger--avatar" aria-label="Открыть информацию о чате" aria-expanded={activeChatTab === "profile"} onClick={() => { setActiveChatTab("profile"); setChatDetailsOpen(true); }}>
                <ChatAvatar chat={activeChat} compact />
              </button>
              <button type="button" className="chat-profile-trigger chat-profile-trigger--title" aria-label={`О чате ${activeChat.title}`} onClick={() => { setActiveChatTab("profile"); setChatDetailsOpen(true); }}>
                <div className="chat-view__title">{activeChat.title}</div>
                <div className="chat-view__status">
                  {typingUsers.size > 0
                    ? `${typingUsers.size} печатает…`
                    : onlineUsers.size > 0 ? `${onlineUsers.size} online` : activeChat.description || "был(а) недавно"}
                </div>
              </button>
              <button
                type="button"
                className="ai-panel__toggle"
                onClick={() => setAIPanelOpen((open) => !open)}
                aria-expanded={aiPanelOpen}
                aria-label={aiPanelOpen ? "Закрыть ИИ-помощника" : "Открыть ИИ-помощника"}
              >
                ✨ ИИ
              </button>
              <button
                type="button"
                className="chat-search-toggle"
                aria-label={searchOpen ? "Закрыть поиск" : "Открыть поиск"}
                aria-expanded={searchOpen}
                aria-controls="chat-message-search"
                onClick={() => { setSearchOpen((open) => !open); setActiveChatTab("messages"); if (activeThread) closeThread(); }}
              >⌕ Поиск</button>
              <button
                type="button"
                className="call-start-button"
                onClick={() => setCallPanelOpen(true)}
                aria-label="Начать звонок"
                title="Аудио- и видеозвонок"
              >
                ☎ <span>Позвонить</span>
              </button>
            </header>

            {chatAvatarError && (
              <p className="chat-create-error" role="alert">
                {chatAvatarError}
              </p>
            )}

            {activeChatTab === "profile" && <section className="chat-details" aria-label="Информация о чате">
              <button type="button" className="chat-profile-back" onClick={() => setActiveChatTab("messages")}>← Вернуться к сообщениям</button>
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
                  <section className="personal-chat-avatar" aria-label="Личная картинка чата">
                    <ChatAvatar chat={activeChat} />
                    <div className="personal-chat-avatar__content">
                      <h3>Моя картинка чата</h3>
                      <p>Видна только вам. Можно выбрать свою для любого чата.</p>
                      <div className="personal-chat-avatar__actions">
                        <label className={`personal-avatar-upload ${personalAvatarBusy ? "is-busy" : ""}`}>
                          {personalAvatarBusy ? "Сохранение…" : "Выбрать картинку"}
                          <input type="file" aria-label="Моя картинка чата" accept="image/jpeg,image/png,image/webp,image/gif" hidden disabled={personalAvatarBusy} onChange={(event) => {
                            const file = event.target.files?.[0]; event.target.value = "";
                            if (file) changePersonalAvatar(file);
                          }} />
                        </label>
                        {activeChat.personal_avatar_url && <button type="button" disabled={personalAvatarBusy} onClick={() => changePersonalAvatar(null)}>Вернуть общую картинку</button>}
                      </div>
                      {personalAvatarError && <p role="alert" className="personal-avatar-error">{personalAvatarError}</p>}
                    </div>
                  </section>
                  <label className="chat-avatar-upload chat-avatar-upload--shared">
                    {uploadingChatAvatars ? "Загрузка…" : "Добавить общее фото чата"}
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden disabled={uploadingChatAvatars} onChange={handleChatAvatarSelection} />
                  </label>
                  <div className="chat-preferences">
                    <label>Цвет чата <input type="color" value={chatPrefs.color || "#64748b"} onChange={(e) => setChatPrefs((p) => ({ ...p, color: e.target.value }))} /></label>
                    <label>Фон <input type="color" value={chatPrefs.background || "#ffffff"} onChange={(e) => setChatPrefs((p) => ({ ...p, background: e.target.value }))} /></label>
                    <label><input type="checkbox" checked={chatPrefs.muted} onChange={(e) => setChatPrefs((p) => ({ ...p, muted: e.target.checked }))} /> Без уведомлений</label>
                    <label><input type="checkbox" checked={chatPrefs.sound} onChange={(e) => setChatPrefs((p) => ({ ...p, sound: e.target.checked }))} /> Звук</label>
                    <label><input type="checkbox" checked={chatPrefs.shareReads} onChange={(e) => setChatPrefs((p) => ({ ...p, shareReads: e.target.checked }))} /> Показывать прочтение</label>
                    <label><input type="checkbox" checked={chatPrefs.sharePresence} onChange={(e) => setChatPrefs((p) => ({ ...p, sharePresence: e.target.checked }))} /> Показывать статус в сети</label>
                    <button type="button" onClick={() => { if (typeof Notification !== "undefined") Notification.requestPermission(); }}>Включить уведомления</button>
                  </div>
                  <section className="chat-members" aria-label="Участники чата">
                    <h3>Участники</h3>
                    {chatMembers.map((member) => <div key={member.id} className="chat-member">
                      <span>@{member.tag || member.username} · {member.role}</span>
                      {activeChat.owner_id === me?.id && member.id !== me?.id && <select aria-label={`Роль ${member.username}`} value={member.role} onChange={async (event) => {
                        try { await chatsApi.updateMemberRole(chatId, member.id, event.target.value); setChatMembers((current) => current.map((item) => item.id === member.id ? { ...item, role: event.target.value } : item)); }
                        catch (error) { setMessagesError(translateApiError(error, "Не удалось изменить роль")); }
                      }}><option value="member">Участник</option><option value="moderator">Модератор</option></select>}
                    </div>)}
                  </section>
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
            </section>}

            {activeChatTab === "messages" && <><div className="chat-view__messages" ref={messageScrollRef} onScroll={(event) => {
              const node = event.currentTarget;
              followMessagesRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
            }}>
              {activeThread && <header className="active-thread-header"><strong>Тред: {activeThread.text || "Вложение"}</strong><button type="button" onClick={closeThread}>Вернуться в чат</button></header>}
              {threadLoading && activeThread && <p className="chats-empty">Загрузка треда…</p>}
              {searchOpen && <form id="chat-message-search" className="message-search" onSubmit={runMessageSearch} onKeyDown={(event) => {
                if (event.key === "Escape") { setSearchOpen(false); if (searching) resetMessageSearch(); }
              }}>
                <div className="message-search__heading">
                  <div><strong>Поиск в чате</strong><span>Сообщения, файлы и важные детали</span></div>
                  <button type="button" className="message-search__close" aria-label="Скрыть поиск" onClick={() => { setSearchOpen(false); if (searching) resetMessageSearch(); }}>×</button>
                </div>
                <div className="message-search__bar">
                  <div className="message-search__input-wrap">
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" /><path d="m16 16 5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                    <input aria-label="Поиск по сообщениям" placeholder="Что ищем в переписке?" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
                  </div>
                  <button type="submit" className="message-search__submit" disabled={searchBusy}>{searchBusy ? "Поиск…" : "Найти"}</button>
                </div>
                <details className="message-search__filters">
                  <summary>Фильтры{attachmentFilter || authorFilter || sinceFilter || untilFilter ? " •" : ""}</summary>
                  <div className="message-search__filter-fields">
                <label><span>Вложения</span>
                <select aria-label="Тип вложения" value={attachmentFilter} onChange={(e) => setAttachmentFilter(e.target.value)}>
                  <option value="">Любой тип</option><option value="image">Фото</option><option value="video">Видео</option><option value="audio">Аудио</option><option value="file">Файлы</option>
                </select>
                </label>
                <label><span>Кто отправил</span>
                <select aria-label="Автор сообщения" value={authorFilter} onChange={(e) => setAuthorFilter(e.target.value)}><option value="">Все авторы</option>{chatMembers.map((member) => <option key={member.id} value={member.id}>{member.username}</option>)}</select>
                </label>
                <label><span>Начиная с</span><input type="datetime-local" aria-label="Начало периода" value={sinceFilter} onChange={(e) => setSinceFilter(e.target.value)} /></label>
                <label><span>До</span><input type="datetime-local" aria-label="Конец периода" value={untilFilter} min={sinceFilter || undefined} onChange={(e) => setUntilFilter(e.target.value)} /></label>
                  </div>
                </details>
                {searching && <div className="message-search__results" aria-live="polite"><span>Найдено сообщений: {messages.length}</span><button type="button" onClick={resetMessageSearch}>Сбросить</button></div>}
              </form>}
              {messagesLoading && (
                <p className="chats-empty">Загрузка сообщений…</p>
              )}
              {messagesError && (
                <p className="chats-empty" style={{ color: "var(--danger)" }}>
                  {messagesError}
                </p>
              )}

              {!messagesLoading &&
                (activeThread ? threadMessages : messages).map((m) => (
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
                    onReply={replyToMessage}
                    onJumpTo={jumpToMessage}
                    readBy={m.user_id === me?.id && chatMembers.some((member) => member.id !== me?.id && member.last_read_message_id === m.id)}
                  />
                ))}
              <div ref={bottomRef} />
            </div>

            {/* ---------- Composer ---------- */}
            <div className="chat-view__composer-wrapper">
              <FormatToolbar onFormat={applyFormat} visible={showFormat} />
              {mentionSuggestions.length > 0 && <div className="mention-suggestions" role="listbox" aria-label="Упоминания">
                {mentionSuggestions.map((member) => <button key={member.id} type="button" role="option" onClick={() => {
                  const tag = member.tag || member.username;
                  setText((current) => current.replace(/(?:^|\s)@[^\s]*$/, (match) => `${match.startsWith(" ") ? " " : ""}@${tag} `));
                  textareaRef.current?.focus();
                }}>@{member.tag || member.username}</button>)}
              </div>}

              <form className="chat-view__composer" onSubmit={handleSend}>
                {activeThread && <div className="reply-preview"><span>Ответ в треде</span><button type="button" onClick={closeThread} aria-label="Закрыть тред">×</button></div>}
                {replyTo && <div className="reply-preview"><span>Ответ: {replyTo.text || "вложение"}</span><button type="button" onClick={() => setReplyTo(null)} aria-label="Отменить ответ">×</button></div>}
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
                  type="button"
                  className="composer-btn composer-btn--send"
                  aria-label="Отправить"
                  aria-haspopup="dialog"
                  aria-expanded={scheduleOpen}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    sendHeldRef.current = false;
                    clearTimeout(sendHoldTimerRef.current);
                    sendHoldTimerRef.current = setTimeout(() => {
                      sendHeldRef.current = true;
                      setScheduleOpen(true);
                    }, 600);
                  }}
                  onPointerUp={() => clearTimeout(sendHoldTimerRef.current)}
                  onPointerCancel={() => { clearTimeout(sendHoldTimerRef.current); sendHeldRef.current = true; }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") { event.preventDefault(); setScheduleOpen(true); }
                  }}
                  onClick={(event) => {
                    if (sendHeldRef.current) { sendHeldRef.current = false; return; }
                    if (!scheduleOpen) handleSend(event);
                  }}
                  disabled={
                    sending ||
                    (!text.trim() && selectedFiles.length === 0 && !recordedAudio)
                  }
                  title="Отправить · удерживайте для выбора времени"
                >
                  ➤
                </button>
              </form>
              {scheduleOpen && <div className="schedule-send" role="dialog" aria-label="Отложенная отправка" onKeyDown={(event) => {
                if (event.key === "Escape") { setScheduleOpen(false); setScheduledAt(""); }
              }}>
                <label>Отправить позже <input autoFocus type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></label>
                <button type="button" disabled={!scheduledAt || sending} onClick={handleSend}>Запланировать</button>
                <button type="button" onClick={() => { setScheduleOpen(false); setScheduledAt(""); }}>Отмена</button>
              </div>}

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
            </div></>}
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
            ref={messageMenuRef}
            className="reaction-picker message-context-menu"
            role="dialog"
            aria-label="Действия с сообщением"
            style={{
              top: reactionPicker.y,
              left: reactionPicker.x,
            }}
          >
            <div className="message-context-menu__reactions" aria-label="Реакции">
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
            {menuMessage && <div className="message-context-menu__actions">
              <button type="button" onClick={() => runMenuAction(() => replyToMessage(menuMessage))}>Ответить</button>
              <button type="button" onClick={() => runMenuAction(() => openThread(menuMessage))}>Открыть тред</button>
              <button type="button" onClick={() => runMenuAction(() => { setForwarding(menuMessage); setForwardTarget(""); setForwardError(""); })}>Переслать</button>
              <button type="button" onClick={() => runMenuAction(() => pinMessage(menuMessage))}>{menuMessage.is_pinned ? "Открепить" : "Закрепить"}</button>
              {menuMessage.user_id === me?.id && <>
                <button type="button" onClick={() => runMenuAction(() => editMessage(menuMessage))}>Изменить</button>
                <button type="button" className="message-context-menu__delete" onClick={() => runMenuAction(() => removeMessage(menuMessage.id))}>Удалить</button>
              </>}
            </div>}
          </div>
        </>
      )}

      {forwarding && <div className="modal-backdrop" onClick={() => { if (!forwardBusy) setForwarding(null); }}>
        <form className="modal forward-message-modal" role="dialog" aria-modal="true" aria-label="Переслать сообщение" onClick={(event) => event.stopPropagation()} onSubmit={handleForward} onKeyDown={(event) => { if (event.key === "Escape" && !forwardBusy) setForwarding(null); }}>
          <h3>Переслать сообщение</h3>
          <p>{forwarding.text || "Сообщение с вложениями"}</p>
          <label>Куда переслать<select autoFocus value={forwardTarget} onChange={(event) => setForwardTarget(event.target.value)} disabled={forwardBusy}>
            <option value="">Выберите чат</option>
            {chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title}</option>)}
          </select></label>
          {forwardError && <p role="alert">{forwardError}</p>}
          <button type="submit" disabled={!forwardTarget || forwardBusy}>{forwardBusy ? "Пересылка…" : "Переслать"}</button>
          <button type="button" disabled={forwardBusy} onClick={() => setForwarding(null)}>Отмена</button>
        </form>
      </div>}

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
                    <span>{user.username} <small>@{user.tag}</small></span>
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
                    <span>{user.username} <small>@{user.tag}</small></span>
                    <button
                      type="button"
                      aria-label={`Убрать @${user.tag}`}
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
      <CallPanel
        chatId={chatId}
        chatName={activeChat?.title}
        open={callPanelOpen}
        onClose={() => setCallPanelOpen(false)}
      />
    </main>
  );
}
