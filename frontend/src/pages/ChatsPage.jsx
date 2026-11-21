import React, {
  lazy,
  Suspense,
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
import ChatMemberProfile, { MemberAvatar, MemberRole } from "../components/ChatMemberProfile";
import ChatPreferences from "../components/ChatPreferences";
import PinnedMessages from "../components/PinnedMessages";
import PollCard from "../components/PollCard";
import CreatePollModal from "../components/CreatePollModal";
import { getAvatarImageError } from "../api/imageUpload";
import { isWebPushEnabled } from "../api/push";
import { formatMessageSelection } from "../utils/messageFormatting";
import { parseMessageMarkdown } from "../utils/messageMarkdown";
import { messageContentPreview, messageTimestamp, summarizeMessageText } from "../utils/messagePreview";

const MarkdownAttachmentPreview = lazy(() => import("../components/MarkdownAttachmentPreview"));
const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;

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
   Набор эмодзи для реакций
   ============================================================ */

const EMOJI_SET = ["👍", "❤️", "🔥", "😂", "😮", "😢", "🎉", "👏"];

function mergePinnedMessage(messages, message) {
  if (!message.is_pinned) return messages.filter((item) => item.id !== message.id && (!message.deleted || item.thread_root_id !== message.id));
  return messages.some((item) => item.id === message.id)
    ? messages.map((item) => item.id === message.id ? { ...item, ...message } : item)
    : [message, ...messages];
}

function getSharedChatAvatarUrls(chat) {
  const avatarUrls = Array.isArray(chat?.avatar_urls)
    ? chat.avatar_urls.filter((url) => typeof url === "string" && url)
    : [];
  if (avatarUrls.length) return avatarUrls;
  return chat?.avatar_url ? [chat.avatar_url] : [];
}

function getChatAvatarUrls(chat) {
  return chat?.personal_avatar_url ? [chat.personal_avatar_url] : getSharedChatAvatarUrls(chat);
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
  const isMarkdown = MARKDOWN_EXTENSION.test(file_name || "") ||
    /^(?:text\/markdown|text\/x-markdown)(?:\s*;|$)/i.test(mime_type || "");
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
            <Suspense fallback={<div className="markdown-attachment__content markdown-attachment__status" role="status">Загрузка Markdown…</div>}>
              <MarkdownAttachmentPreview id={id} text={attachmentText} fileName={fileName} />
            </Suspense>
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

function MediaViewer({ attachments, index, onClose, onChange, onDownload, label = "Просмотр вложения", previousLabel = "Предыдущее вложение", nextLabel = "Следующее вложение" }) {
  const attachment = attachments[index];
  const isVideo = attachment?.mime_type?.startsWith("video/");
  const viewerRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    viewerRef.current?.querySelector("button")?.focus();
    return () => { if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (["Escape", "ArrowLeft", "ArrowRight"].includes(event.key)) event.preventDefault();
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onChange(-1);
      if (event.key === "ArrowRight") onChange(1);
      if (event.key === "Tab") {
        const buttons = viewerRef.current?.querySelectorAll("button");
        const first = buttons?.[0];
        const last = buttons?.[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
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
      <section ref={viewerRef} className="media-viewer" role="dialog" aria-modal="true" aria-label={label}>
        <header className="media-viewer__header">
          <span className="media-viewer__name">{attachment.file_name}</span>
          <span className="media-viewer__count" aria-live="polite">{index + 1} / {attachments.length}</span>
          {onDownload && <button
            type="button"
            className="media-viewer__download"
            onClick={() => onDownload(attachment)}
          >
            Скачать оригинал
          </button>}
          <button type="button" className="media-viewer__close" onClick={onClose} aria-label="Закрыть просмотр">
            ×
          </button>
        </header>
        <div className="media-viewer__stage">
          {attachments.length > 1 && (
            <button type="button" className="media-viewer__nav" onClick={() => onChange(-1)} aria-label={previousLabel}>
              ‹
            </button>
          )}
          {isVideo ? (
            <video key={attachment.file_key} src={attachment.file_key} controls autoPlay />
          ) : (
            <img src={attachment.file_key} alt={attachment.file_name || "Изображение"} />
          )}
          {attachments.length > 1 && (
            <button type="button" className="media-viewer__nav" onClick={() => onChange(1)} aria-label={nextLabel}>
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

const MESSAGE_GESTURE_SLOP = 12;
const MESSAGE_SWIPE_DISTANCE = 60;
const MESSAGE_HOLD_MS = 550;

const MessageItem = React.memo(function MessageItem({
  message: m,
  authorName,
  isMe,
  onReaction,
  onContextMenu,
  onTranscribe,
  onDownload,
  transcribingAttachments,
  onOpenMedia,
  onReply,
  onJumpTo,
  replySource,
  replyAuthor,
  readBy,
  pollVersion,
  pollRefresh,
  pollMenuTarget,
  onCloseMenu,
  liveLinkPreviews,
}) {
  const gestureRef = useRef(null);
  const holdTimerRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  useEffect(() => () => clearTimeout(holdTimerRef.current), []);

  const resetGesture = () => {
    clearTimeout(holdTimerRef.current);
    gestureRef.current = null;
    setSwipeOffset(0);
  };
  const startGesture = (event) => {
    if (event.isPrimary === false) return;
    suppressClickRef.current = false;
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    if (event.button !== 0 || event.target.closest("input, textarea, select, video, audio, [contenteditable], .markdown-attachment__content")) return;

    const start = { id: event.pointerId, x: event.clientX, y: event.clientY };
    gestureRef.current = start;
    event.target.setPointerCapture?.(event.pointerId);
    holdTimerRef.current = setTimeout(() => {
      suppressClickRef.current = true;
      resetGesture();
      onContextMenu(m.id, start.x, start.y);
    }, MESSAGE_HOLD_MS);
  };
  const moveGesture = (event) => {
    const start = gestureRef.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.swiping && Math.max(Math.abs(dx), Math.abs(dy)) < MESSAGE_GESTURE_SLOP) return;

    clearTimeout(holdTimerRef.current);
    if (!start.swiping && Math.abs(dy) >= Math.abs(dx)) {
      resetGesture();
      return;
    }
    start.swiping = true;
    suppressClickRef.current = true;
    setSwipeOffset(Math.max(-72, Math.min(72, dx)));
  };
  const finishGesture = (event) => {
    const start = gestureRef.current;
    if (!start || start.id !== event.pointerId) return;
    resetGesture();
    const dx = Math.abs(event.clientX - start.x);
    const dy = Math.abs(event.clientY - start.y);
    if (dx >= MESSAGE_SWIPE_DISTANCE && dx > dy * 1.5) {
      suppressClickRef.current = true;
      onReply(m);
    }
  };
  const { html, previewUrl } = useMemo(() => parseMessageMarkdown(m.text), [m.text]);
  const linkPreview = liveLinkPreviews?.[previewUrl] ||
    (m.link_preview?.url === previewUrl ? m.link_preview : null);
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
  const replyText = replySource
    ? messageContentPreview(replySource)
    : summarizeMessageText(m.reply_to_text);

  return (
    <div
      id={`message-${m.id}`}
      className={`msg ${isMe ? "msg--me" : ""}${m.poll_id ? " msg--poll" : ""}`}
      tabIndex={0}
      aria-haspopup="dialog"
      onContextMenu={(event) => {
        event.preventDefault();
        if (suppressClickRef.current) return;
        suppressClickRef.current = Boolean(gestureRef.current);
        resetGesture();
        onContextMenu(m.id, event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        onContextMenu(m.id, bounds.left, bounds.bottom, event.target);
      }}
      style={{ translate: swipeOffset ? `${swipeOffset}px` : undefined }}
      onPointerDown={startGesture}
      onPointerMove={moveGesture}
      onPointerUp={finishGesture}
      onPointerCancel={(event) => {
        if (gestureRef.current?.id === event.pointerId) resetGesture();
      }}
      onLostPointerCapture={(event) => {
        if (gestureRef.current?.id === event.pointerId) resetGesture();
      }}
      onClickCapture={(event) => {
        if (!suppressClickRef.current || event.detail === 0) return;
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      title="Правый клик — действия с сообщением"
    >
      {!isMe && (
        <div className="msg__author">
          {authorName || m.user_name || "Участник"}
        </div>
      )}
      <div className="msg__bubble">
        {m.is_forwarded && (
          <div className="msg__forwarded">
            <span aria-hidden="true">↪</span> Пересланное сообщение
          </div>
        )}
        {m.is_pinned && <span className="msg__pin-label">Закреплено</span>}
        {m.reply_to_id && (
          <button type="button" className="msg__reply-quote" onClick={() => onJumpTo(m.reply_to_id)}>
            <span className="msg__reply-author">{replyAuthor || "Исходное сообщение"}</span>{" "}
            {replyText && <span className="msg__reply-text">{replyText}</span>}
          </button>
        )}
        {m.poll_id && <PollCard pollId={m.poll_id} version={pollVersion} refreshKey={pollRefresh} menuTarget={pollMenuTarget} onCloseMenu={onCloseMenu} />}
        {m.text && !m.poll_id && (
          <div
            className="msg__text"
            dangerouslySetInnerHTML={{ __html: html }}
            onClick={(event) => {
              const button = event.target.closest(".message-spoiler__toggle");
              if (!button) return;
              const content = button.nextElementSibling;
              const revealed = content.hidden;
              content.hidden = !revealed;
              button.setAttribute("aria-expanded", String(revealed));
              button.textContent = revealed ? "Скрыть" : "Спойлер";
            }}
          />
        )}

        {linkPreview && !m.poll_id && (
          <a className="msg__link-preview" href={linkPreview.url} target="_blank" rel="noopener noreferrer">
            <span className="msg__link-preview-host">{new URL(linkPreview.url).hostname}</span>
            <strong>{linkPreview.title}</strong>
            {linkPreview.description && <span>{linkPreview.description}</span>}
          </a>
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
        <span className="msg__time">{msgTime(m.created_at)}{m.edited_at ? " · изменено" : ""}{isMe && readBy ? " · прочитано" : ""}</span>
      </div>
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
  const isOwnMessage = (message) => Boolean(me?.id) && message.user_id === me.id;

  const [chats, setChats] = useState([]);
  const [friends, setFriends] = useState(null);
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
  const [liveLinkPreviews, setLiveLinkPreviews] = useState({});
  const [pollComposer, setPollComposer] = useState(null);
  const [pollVersions, setPollVersions] = useState({});
  const [pollRefresh, refreshPolls] = useReducer((version) => version + 1, 0);
  const [activeThread, setActiveThread] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threads, setThreads] = useState([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState("");
  const [threadsVersion, refreshThreads] = useReducer((version) => version + 1, 0);
  const [pinnedMessages, setPinnedMessages] = useState([]);
  const pinnedMessageIds = useMemo(() => new Set(pinnedMessages.map((message) => message.id)), [pinnedMessages]);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [pinsError, setPinsError] = useState("");
  const [pinBusyId, setPinBusyId] = useState(null);
  const pinBusyRef = useRef(null);
  const [pendingJumpId, setPendingJumpId] = useState(null);
  const activeChatIdRef = useRef(chatId);
  activeChatIdRef.current = chatId;
  const pinsRequestRef = useRef(0);
  const pinsVersionRef = useRef(0);
  const pinChangesRef = useRef(new Map());
  const applyPinUpdate = useCallback((message) => {
    if (message.is_pinned === undefined) return;
    pinChangesRef.current.set(message.id, { version: ++pinsVersionRef.current, message });
    setPinnedMessages((items) => mergePinnedMessage(items, message));
  }, []);
  const loadPinnedMessages = useCallback(async () => {
    if (!chatId) return;
    const request = ++pinsRequestRef.current;
    const version = pinsVersionRef.current;
    setPinsLoading(true);
    setPinsError("");
    try {
      let loaded = await messagesApi.listPinnedMessages(chatId);
      if (request !== pinsRequestRef.current || activeChatIdRef.current !== chatId) return;
      for (const change of pinChangesRef.current.values()) {
        if (change.version > version) loaded = mergePinnedMessage(loaded, change.message);
      }
      setPinnedMessages(loaded);
    } catch (error) {
      if (request === pinsRequestRef.current) setPinsError(translateApiError(error, "Не удалось загрузить закреплённые сообщения"));
    } finally {
      if (request === pinsRequestRef.current) setPinsLoading(false);
    }
  }, [chatId]);
  useEffect(() => {
    setPinnedMessages([]);
    setPinsError("");
    setPinsLoading(false);
    setPendingJumpId(null);
    pinChangesRef.current.clear();
    loadPinnedMessages();
    return () => { pinsRequestRef.current += 1; };
  }, [loadPinnedMessages]);
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
    setPollComposer(null);
    setPollVersions({});
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
  const [chatPrefsChatId, setChatPrefsChatId] = useState(null);
  const chatPrefsRef = useRef(chatPrefs);
  chatPrefsRef.current = chatPrefs;
  const [chatMembers, setChatMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const [membersReload, reloadMembers] = useReducer((value) => value + 1, 0);
  const [profileMemberId, setProfileMemberId] = useState(null);
  const closeMemberProfile = useCallback(() => setProfileMemberId(null), []);
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
  const [avatarPreviews, setAvatarPreviews] = useState([]);
  const [avatarSelectionError, setAvatarSelectionError] = useState("");
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
  const [pollMenuTarget, setPollMenuTarget] = useState(null);
  useEffect(() => {
    if (!reactionPicker) return;
    const menu = messageMenuRef.current;
    if (!menu) return;
    const positionMenu = () => {
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(reactionPicker.x, window.innerWidth - bounds.width - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(reactionPicker.y, window.innerHeight - bounds.height - 8))}px`;
    };
    positionMenu();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(positionMenu) : null;
    observer?.observe(menu);
    menu.querySelector("button")?.focus();
    const dismiss = (event) => {
      if (event.key === "Escape") {
        setReactionPicker(null);
        reactionPicker.trigger?.focus();
      }
    };
    window.addEventListener("keydown", dismiss);
    return () => { observer?.disconnect(); window.removeEventListener("keydown", dismiss); };
  }, [reactionPicker]);
  useEffect(() => () => clearTimeout(sendHoldTimerRef.current), []);
  const [galleryIndex, setGalleryIndex] = useState(null);
  const [avatarGalleryIndex, setAvatarGalleryIndex] = useState(null);

  const bottomRef = useRef(null);
  const messageScrollRef = useRef(null);
  const followMessagesRef = useRef(true);
  const socketRef = useRef(null);
  const socketOpenRef = useRef(false);
  const typingSentAtRef = useRef(0);
  const typingUsersTimeoutsRef = useRef(new Map());
  const textareaRef = useRef(null);
  const sendingRef = useRef(false);
  const mediaRecorderRef = useRef(null);
  const recordingStreamRef = useRef(null);
  const recordingChunksRef = useRef([]);
  const recordingTimerRef = useRef(null);

  useEffect(() => {
    const previews = createOpen ? selectedAvatarFiles.map((file) => URL.createObjectURL(file)) : [];
    setAvatarPreviews(previews);
    return () => previews.forEach((url) => URL.revokeObjectURL(url));
  }, [selectedAvatarFiles, createOpen]);

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
    setChatPrefsChatId(chatId);
  }, [chatId]);

  useEffect(() => {
    if (chatId) localStorage.setItem(`chat-draft:${chatId}`, text);
  }, [chatId, text]);

  useEffect(() => {
    if (chatId && chatPrefsChatId === chatId) localStorage.setItem(`chat-prefs:${chatId}`, JSON.stringify(chatPrefs));
  }, [chatId, chatPrefs, chatPrefsChatId]);

  const lastMessage = messages.at(-1);
  const readMessageId = lastMessage?.chat_id === chatId ? lastMessage?.id : null;
  useEffect(() => {
    if (!chatId || chatPrefsChatId !== chatId || !readMessageId || !chatPrefs.shareReads) return;
    chatsApi.markChatRead(chatId, readMessageId).catch(() => {});
  }, [chatId, chatPrefsChatId, readMessageId, chatPrefs.shareReads]);

  useEffect(() => {
    let cancelled = false;
    setChatMembers([]);
    setMembersError("");
    setProfileMemberId(null);
    setMembersLoading(Boolean(chatId));
    if (!chatId) return;
    Promise.resolve(chatsApi.getChatMembers?.(chatId))
      .then((rows) => { if (!cancelled) setChatMembers(rows || []); })
      .catch(() => { if (!cancelled) setMembersError("Не удалось загрузить участников"); })
      .finally(() => { if (!cancelled) setMembersLoading(false); });
    return () => { cancelled = true; };
  }, [chatId, membersReload]);

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
    setLiveLinkPreviews({});
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
    setAvatarGalleryIndex(null);
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
          refreshPolls();
          loadPinnedMessages();
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
          if (event === "poll:updated" && data.chat_id === chatId) {
            setPollVersions((versions) => ({ ...versions, [data.poll_id]: Math.max(versions[data.poll_id] || 0, data.version) }));
          }
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
            const { muted, sound } = chatPrefsRef.current;
            const localNotification = !muted && data.user_id !== me?.id && !isWebPushEnabled(me?.id);
            if (localNotification && sound && typeof AudioContext !== "undefined") {
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
            if (localNotification && typeof Notification !== "undefined" && Notification.permission === "granted") {
              const preview = summarizeMessageText(data.text) || "Вложение";
              const mentionsMe = Boolean(me?.tag) && preview.toLowerCase().includes(`@${me.tag.toLowerCase()}`);
              try {
                new Notification(mentionsMe ? "Вас упомянули" : "Новое сообщение", {
                  body: preview, tag: `chat-${chatId}`, silent: !sound,
                });
              } catch {}
            }
          }
          if (event === "message:link-preview" && data.chat_id === chatId) {
            const { message_id: messageId, preview } = data;
            setLiveLinkPreviews((previous) => ({
              ...previous,
              [messageId]: { ...previous[messageId], [preview.url]: preview },
            }));
          }
          if (event === "message:updated" && data.chat_id === chatId) {
            applyPinUpdate(data);
            updateChatPreview(chatId, data, true);
            setMessages((prev) => prev.map((item) => item.id === data.id ? { ...item, ...data } : item));
            setThreadMessages((prev) => prev.map((item) => item.id === data.id ? { ...item, ...data } : item));
          }
          if (event === "message:deleted" && data.chat_id === chatId) {
            applyPinUpdate({ id: data.message_id, is_pinned: false, deleted: true });
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
  }, [chatId, chatPrefs.sharePresence, loadPinnedMessages, applyPinUpdate]);

  /* ---------- 4. Скролл вниз ---------- */
  useEffect(() => {
    const container = messageScrollRef.current;
    if (container && followMessagesRef.current) container.scrollTop = container.scrollHeight;
  }, [messages, threadMessages, activeThread, replyTo, showFormat]);

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
              MARKDOWN_EXTENSION.test(file.name) ||
              /\.(txt|csv|json|xml|log)$/i.test(file.name);
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
    if (e.target.selectionStart === e.target.selectionEnd) setShowFormat(false);

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
  const applyFormat = (format) => {
    const el = textareaRef.current;
    if (!el || el.disabled) return;
    const formatted = formatMessageSelection(el.value, el.selectionStart, el.selectionEnd, format);
    setText(formatted.text);

    requestAnimationFrame(() => {
      if (textareaRef.current !== el || el.disabled) return;
      el.focus();
      el.setSelectionRange(formatted.start, formatted.end);
      setShowFormat(formatted.start !== formatted.end);
    });
  };

  const updateFormatVisibility = useCallback(() => {
    const el = textareaRef.current;
    if (el && document.activeElement === el) {
      setShowFormat(el.selectionStart !== el.selectionEnd);
    }
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", updateFormatVisibility);
    return () => document.removeEventListener("selectionchange", updateFormatVisibility);
  }, [updateFormatVisibility]);

  /* ---------- 8. Клавиатура ---------- */
  const handleKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
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
      if (e.code === "KeyB" || e.key.toLowerCase() === "b") {
        e.preventDefault();
        applyFormat("bold");
      } else if (e.code === "KeyI" || e.key.toLowerCase() === "i") {
        e.preventDefault();
        applyFormat("italic");
      } else if (e.code === "KeyU" || e.key.toLowerCase() === "u") {
        e.preventDefault();
        applyFormat("code");
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
    if (!files.length || !chatId || !canEditSharedAvatar) return;

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

  const openReactionPicker = useCallback((messageId, x, y, trigger) => {
    setReactionPicker({ messageId, x, y, trigger });
  }, []);

  const closeReactionPicker = useCallback(() => setReactionPicker(null), []);

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
  const canEditSharedAvatar = Boolean(me?.id && (
    activeChat?.owner_id === me.id || chatMembers.some((member) => member.id === me.id && member.role === "moderator")
  ));
  const messagesById = useMemo(
    () => new Map([...messages, ...threadMessages].map((message) => [message.id, message])),
    [messages, threadMessages],
  );
  const getMessageAuthor = (message) => message && (
    chatMembers.find((member) => member.id === message.user_id)?.username ||
    message.user_name || (isOwnMessage(message) ? me.username : "")
  );
  const replyAuthor = getMessageAuthor(replyTo);
  const sharedChatAvatars = useMemo(() => getSharedChatAvatarUrls(activeChat).map((url, index) => ({
    file_key: url,
    file_name: `Аватарка группы ${index + 1}`,
    mime_type: "image/*",
  })).reverse(), [activeChat]);
  const closeAvatarGallery = useCallback(() => setAvatarGalleryIndex(null), []);
  const moveAvatarGallery = useCallback((offset) => {
    setAvatarGalleryIndex((index) => index === null || !sharedChatAvatars.length
      ? null : (index + offset + sharedChatAvatars.length) % sharedChatAvatars.length);
  }, [sharedChatAvatars.length]);
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

  const menuMessageSource = reactionPicker
    ? [...messages, ...threadMessages].find((message) => message.id === reactionPicker.messageId)
    : null;
  const menuMessage = menuMessageSource && !pinsLoading && !pinsError
    ? { ...menuMessageSource, is_pinned: pinnedMessageIds.has(menuMessageSource.id) } : menuMessageSource;
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
      const created = await messagesApi.forwardMessage(chatId, forwarding.id, forwardTarget, forwarding.text);
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
      if (activeChatIdRef.current === updated.chat_id) applyPinUpdate(updated);
      updateChatPreview(updated.chat_id || chatId, updated, true);
      setMessages((previous) => previous.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      setThreadMessages((previous) => previous.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
      refreshThreads();
    } catch (error) { setMessagesError(translateApiError(error, "Не удалось изменить сообщение")); }
  }, [chatId, updateChatPreview, applyPinUpdate]);
  const removeMessage = useCallback(async (messageId) => {
    if (!window.confirm("Удалить это сообщение?")) return;
    try {
      await messagesApi.deleteMessage(messageId);
      applyPinUpdate({ id: messageId, is_pinned: false, deleted: true });
      refreshChatPreviews();
      setMessages((previous) => previous.filter((item) => item.id !== messageId));
      setThreadMessages((previous) => previous.filter((item) => item.id !== messageId));
      if (activeThreadRef.current?.id === messageId) setActiveThread(null);
      refreshThreads();
    }
    catch (error) { setMessagesError(translateApiError(error, "Не удалось удалить сообщение")); }
  }, [refreshChatPreviews, applyPinUpdate]);
  const pinMessage = useCallback(async (message) => {
    if (pinBusyRef.current) return;
    pinBusyRef.current = message.id;
    setPinBusyId(message.id);
    try {
      const pinned = await messagesApi.togglePin(chatId, message.id);
      if (activeChatIdRef.current !== chatId) return;
      applyPinUpdate({ ...message, is_pinned: pinned });
      setMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, is_pinned: pinned } : item));
      setThreadMessages((previous) => previous.map((item) => item.id === message.id ? { ...item, is_pinned: pinned } : item));
    } catch (error) { if (activeChatIdRef.current === chatId) setMessagesError(translateApiError(error, "Не удалось закрепить сообщение")); }
    finally { pinBusyRef.current = null; setPinBusyId(null); }
  }, [chatId, applyPinUpdate]);
  const jumpToMessage = useCallback((id) => {
    const node = document.getElementById(`message-${id}`);
    const container = messageScrollRef.current;
    if (node && container) container.scrollTop += node.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientHeight / 2;
  }, []);
  const openPinnedMessage = async (message) => {
    const targetChatId = chatId;
    followMessagesRef.current = false;
    setSearchOpen(false);
    setSearching(false);
    setActiveChatTab("messages");
    if (message.thread_root_id) {
      const opening = openThread(message);
      const request = threadRequestRef.current;
      await opening;
      if (activeChatIdRef.current !== targetChatId || request !== threadRequestRef.current) return;
      setThreadMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message].sort((a, b) => messageTimestamp(a.created_at) - messageTimestamp(b.created_at)));
    } else {
      closeThread();
      setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message].sort((a, b) => messageTimestamp(a.created_at) - messageTimestamp(b.created_at)));
    }
    followMessagesRef.current = false;
    setPendingJumpId(message.id);
  };
  useEffect(() => {
    if (!pendingJumpId || !document.getElementById(`message-${pendingJumpId}`)) return;
    jumpToMessage(pendingJumpId);
    document.getElementById(`message-${pendingJumpId}`).animate?.([
      { backgroundColor: "var(--spark-dim)" }, { backgroundColor: "transparent" },
    ], { duration: 1400 });
    setPendingJumpId(null);
  }, [pendingJumpId, messages, threadMessages, jumpToMessage]);
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
        friends={friends ?? []}
        setFriends={setFriends}
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
          setAvatarSelectionError("");
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

            {me?.id && activeChat.owner_id && activeChat.owner_id !== me.id &&
              friends && !friends.some((friend) => friend.id === activeChat.owner_id) && (
                <p className="chat-view__creator-notice">
                  Этот чат создал пользователь, которого нет в ваших друзьях.
                </p>
              )}

            {chatAvatarError && (
              <p className="chat-create-error" role="alert">
                {chatAvatarError}
              </p>
            )}

            {activeChatTab === "messages" && <PinnedMessages
              key={`pinned-${chatId}`}
              messages={pinnedMessages}
              loading={pinsLoading}
              error={pinsError}
              onRetry={loadPinnedMessages}
              onOpen={openPinnedMessage}
              onUnpin={pinMessage}
              busy={pinBusyId}
            />}

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
                  <section className="group-avatars" aria-label="Аватарки группы">
                    <div className="group-avatars__heading">
                      <div><h3>Аватарки группы <span>{sharedChatAvatars.length}</span></h3><p>Общие фотографии чата</p></div>
                      {sharedChatAvatars.length > 0 && <button type="button" className="group-avatars__view-all" onClick={() => setAvatarGalleryIndex(0)}>Смотреть все <span aria-hidden="true">↗</span></button>}
                    </div>
                    {sharedChatAvatars.length > 0 ? <div className="group-avatars__list">
                      {sharedChatAvatars.map((avatar, index) => <button type="button" className="group-avatars__photo" key={`${avatar.file_key}-${index}`} aria-label={`Открыть аватарку группы ${index + 1}`} onClick={() => setAvatarGalleryIndex(index)}>
                        <img src={avatar.file_key} alt="" loading="lazy" />
                        {index === 0 && <span>Текущая</span>}
                      </button>)}
                    </div> : <p className="group-avatars__empty">У группы пока нет общих аватарок.</p>}
                    {canEditSharedAvatar && <label className="chat-avatar-upload chat-avatar-upload--shared">
                      {uploadingChatAvatars ? "Загрузка…" : "Добавить общее фото чата"}
                      <input type="file" aria-label="Добавить общее фото чата" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden disabled={uploadingChatAvatars} onChange={handleChatAvatarSelection} />
                    </label>}
                  </section>
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
                  <ChatPreferences key={chatId} chatId={chatId} userId={me?.id} preferences={chatPrefs} onChange={setChatPrefs} />
                  <section className="chat-members" aria-label="Участники чата" aria-busy={membersLoading}>
                    <h3>Участники</h3>
                    {membersLoading && <p className="chat-members__hint" role="status">Загрузка участников…</p>}
                    {membersError && (
                      <div className="chat-members__error" role="alert">
                        {membersError}
                        <button type="button" onClick={reloadMembers}>Повторить</button>
                      </div>
                    )}
                    {!membersLoading && !membersError && chatMembers.length === 0 && (
                      <p className="chat-members__hint">Участников пока нет</p>
                    )}
                    {chatMembers.map((member) => <div key={member.id} className="chat-member">
                      <button type="button" className="chat-member__profile" aria-label={`Открыть профиль ${member.username}`} onClick={() => setProfileMemberId(member.id)}>
                        <MemberAvatar member={member} />
                        <span><strong>{member.username}</strong><small>@{member.tag || member.username}</small></span>
                        <MemberRole role={member.role} />
                      </button>
                      {activeChat.owner_id === me?.id && member.id !== me?.id && <select aria-label={`Роль ${member.username}`} value={member.role} onChange={async (event) => {
                        const role = event.target.value;
                        try { await chatsApi.updateMemberRole(chatId, member.id, role); setChatMembers((current) => current.map((item) => item.id === member.id ? { ...item, role } : item)); }
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
              {activeThread && <header className="active-thread-header"><strong>Тред: {summarizeMessageText(activeThread.text) || "Вложение"}</strong><button type="button" onClick={closeThread}>Вернуться в чат</button></header>}
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
                (activeThread ? threadMessages : messages).map((m) => {
                  const replySource = messagesById.get(m.reply_to_id);
                  return <MessageItem
                    key={m.id}
                    message={pinsLoading || pinsError ? m : { ...m, is_pinned: pinnedMessageIds.has(m.id) }}
                    authorName={chatMembers.find((member) => member.id === m.user_id)?.username}
                    isMe={isOwnMessage(m)}
                    onReaction={handleReaction}
                    onContextMenu={openReactionPicker}
                    onTranscribe={(attachment) => handleTranscribe(m, attachment)}
                    onDownload={downloadMedia}
                    transcribingAttachments={transcribingAttachments}
                    onOpenMedia={openMediaViewer}
                    onReply={replyToMessage}
                    onJumpTo={jumpToMessage}
                    replySource={replySource}
                    replyAuthor={getMessageAuthor(replySource)}
                    pollVersion={pollVersions[m.poll_id] || 0}
                    pollRefresh={pollRefresh}
                    pollMenuTarget={reactionPicker?.messageId === m.id ? pollMenuTarget : null}
                    onCloseMenu={closeReactionPicker}
                    liveLinkPreviews={liveLinkPreviews[m.id]}
                    readBy={chatMembers.some((member) => member.id !== me?.id && member.last_read_message_id === m.id)}
                  />;
                })}
              <div ref={bottomRef} />
            </div>

            {/* ---------- Composer ---------- */}
            <div className="chat-view__composer-wrapper">
              {mentionSuggestions.length > 0 && <div className="mention-suggestions" role="listbox" aria-label="Упоминания">
                {mentionSuggestions.map((member) => <button key={member.id} type="button" role="option" onClick={() => {
                  const tag = member.tag || member.username;
                  setText((current) => current.replace(/(?:^|\s)@[^\s]*$/, (match) => `${match.startsWith(" ") ? " " : ""}@${tag} `));
                  textareaRef.current?.focus();
                }}>@{member.tag || member.username}</button>)}
              </div>}

              {replyTo && (
                <div className="reply-preview">
                  <button type="button" className="reply-preview__message" onClick={() => jumpToMessage(replyTo.id)}>
                    <span className="reply-preview__icon" aria-hidden="true">↩︎</span>
                    <span className="reply-preview__content">
                      <span className="reply-preview__author">{replyAuthor ? `В ответ ${replyAuthor}` : "В ответ на сообщение"}</span>{" "}
                      <span className="reply-preview__text">{messageContentPreview(replyTo)}</span>
                    </span>
                  </button>
                  <button type="button" className="reply-preview__close" aria-label="Отменить ответ" onClick={() => {
                    setReplyTo(null);
                    textareaRef.current?.focus();
                  }}>×</button>
                </div>
              )}

              <form className="chat-view__composer" onSubmit={handleSend} onBlur={(event) => {
                const next = event.relatedTarget;
                if (next !== textareaRef.current && !next?.closest?.(".format-toolbar")) setShowFormat(false);
              }} onKeyDown={(event) => {
                if (event.key !== "Escape" || !showFormat) return;
                const el = textareaRef.current;
                el.focus();
                el.setSelectionRange(el.selectionEnd, el.selectionEnd);
                setShowFormat(false);
              }}>
                {activeThread && <div className="thread-composer-label"><span>Ответ в треде</span><button type="button" onClick={closeThread} aria-label="Закрыть тред">×</button></div>}
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
                <button type="button" className="composer-btn composer-btn--poll" aria-label="Создать опрос" title="Опрос или викторина" disabled={sending || recording} onClick={() => setPollComposer({ chatId, threadRootId: activeThread?.id || null })}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 20V10m8 10V4m8 16v-7M2 20h20" /></svg>
                </button>

                <textarea
                  ref={textareaRef}
                  className="composer-input"
                  placeholder="Написать сообщение…"
                  value={text}
                  rows={1}
                  onChange={handleTextChange}
                  onSelect={updateFormatVisibility}
                  onPointerUp={updateFormatVisibility}
                  onFocus={updateFormatVisibility}
                  onKeyDown={handleKeyDown}
                  onKeyUp={updateFormatVisibility}
                  disabled={sending}
                />
                {showFormat && text && !sending && <FormatToolbar onFormat={applyFormat} />}

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
      {avatarGalleryIndex !== null && sharedChatAvatars[avatarGalleryIndex] && <MediaViewer
        attachments={sharedChatAvatars}
        index={avatarGalleryIndex}
        onClose={closeAvatarGallery}
        onChange={moveAvatarGallery}
        label="Просмотр аватарок группы"
        previousLabel="Предыдущая аватарка"
        nextLabel="Следующая аватарка"
      />}

      {/* ---------- Пикер реакций ---------- */}
      {reactionPicker && (
        <>
          <div
            className="reaction-picker__backdrop"
            onPointerDown={closeReactionPicker}
            onContextMenu={(event) => event.preventDefault()}
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
              {!menuMessage.poll_id && <button type="button" onClick={() => runMenuAction(() => { setForwarding(menuMessage); setForwardTarget(""); setForwardError(""); })}>Переслать</button>}
              <button type="button" disabled={Boolean(pinBusyId)} onClick={() => runMenuAction(() => pinMessage(menuMessage))}>{menuMessage.is_pinned ? "Открепить" : "Закрепить"}</button>
              <div ref={setPollMenuTarget} className="message-context-menu__poll-actions" />
              {isOwnMessage(menuMessage) && <>
                {!menuMessage.poll_id && <button type="button" onClick={() => runMenuAction(() => editMessage(menuMessage))}>Изменить</button>}
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-chat-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleCreateChat}
            onKeyDown={(event) => { if (event.key === "Escape" && !creatingChat) setCreateOpen(false); }}
          >
            <h3 id="create-chat-title">Новая группа</h3>
            <div className="chat-create-identity">
              <div className="chat-create-identity__avatar">
                {avatarPreviews.length ? <img src={avatarPreviews.at(-1)} alt="Превью аватарки группы" /> : (newChat.title.trim()[0] || "+").toUpperCase()}
              </div>
              <div><strong>{newChat.title.trim() || "Ваша новая группа"}</strong><p>{selectedAvatarFiles.length ? "Так будет выглядеть аватарка чата" : "Добавьте фото, чтобы чат было легче найти"}</p></div>
            </div>
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
            <label className="vk-field chat-avatar-picker">
              <span className="vk-field__label">Аватарки группы</span>
              <span className="chat-avatar-picker__button"><span aria-hidden="true">＋</span> Выбрать фотографии</span>
              <input
                type="file"
                className="chat-avatar-picker__input"
                aria-label="Аватарки группы"
                aria-describedby="chat-avatar-picker-hint"
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                disabled={creatingChat}
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  event.target.value = "";
                  if (!files.length) return;
                  const error = files.map(getAvatarImageError).find(Boolean);
                  setAvatarSelectionError(error || "");
                  if (!error) setSelectedAvatarFiles((current) => [...current, ...files]);
                }}
              />
            </label>
            <p id="chat-avatar-picker-hint" className="chat-create-hint">JPEG, PNG, WebP или GIF. Последнее фото станет аватаркой.</p>
            {avatarSelectionError && <p className="chat-create-error" role="alert">{avatarSelectionError}</p>}
            {selectedAvatarFiles.length > 0 && (
              <ul className="chat-selected-avatars" aria-label="Выбранные аватарки">
                {selectedAvatarFiles.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`}>
                    {avatarPreviews[index] && <img src={avatarPreviews[index]} alt={`Превью ${file.name}`} />}
                    <span title={file.name}>{file.name}</span>
                    <button
                      type="button"
                      disabled={creatingChat}
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
      {activeChatTab === "profile" && chatDetailsOpen && chatMembers.some((member) => member.id === profileMemberId) && <ChatMemberProfile
        key={profileMemberId}
        member={chatMembers.find((member) => member.id === profileMemberId)}
        chatTitle={activeChat?.title}
        isMe={profileMemberId === me?.id}
        online={onlineUsers.has(profileMemberId)}
        onClose={closeMemberProfile}
      />}
      {pollComposer && <CreatePollModal
        key={pollComposer.chatId}
        chatId={pollComposer.chatId}
        threadRootId={pollComposer.threadRootId}
        onClose={() => setPollComposer(null)}
        onCreated={(message) => {
          setPollComposer(null);
          updateChatPreview(message.chat_id, message);
          if (activeChatIdRef.current !== message.chat_id) return;
          if (message.thread_root_id) {
            if (activeThreadRef.current?.id === message.thread_root_id) setThreadMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
            refreshThreads();
          } else setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
        }}
      />}
      <CallPanel
        chatId={chatId}
        chatName={activeChat?.title}
        canInvite={canEditSharedAvatar}
        open={callPanelOpen}
        onClose={() => setCallPanelOpen(false)}
      />
    </main>
  );
}
