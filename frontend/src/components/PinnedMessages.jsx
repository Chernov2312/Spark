import { useState } from "react";
import { messagePreview } from "../utils/messagePreview";

export default function PinnedMessages({ messages, loading, error, onRetry, onOpen, onUnpin, busy }) {
  const [expanded, setExpanded] = useState(false);
  if (!messages.length && !error && !loading) return null;
  return (
    <section className="pinned-messages" aria-label="Закреплённые сообщения" aria-busy={loading}>
      {messages.length > 0 ? <>
        <div className="pinned-messages__bar">
          <svg className="pinned-messages__icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5-3 1-4 5v4l-3-3-6 6 6-6-3-3h4l5-4z" /></svg>
          <button type="button" className="pinned-messages__preview" onClick={() => onOpen(messages[0])} aria-label="Перейти к закреплённому сообщению">
            <span>Закреплённое сообщение</span><strong>{messagePreview(messages[0])}</strong>
          </button>
          <button type="button" className="pinned-messages__expand" aria-label={expanded ? "Свернуть закреплённые сообщения" : "Показать все закреплённые сообщения"} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{messages.length}<span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></button>
        </div>
        {expanded && <ol className="pinned-messages__list">
          {messages.map((message) => <li key={message.id}>
            <button type="button" className="pinned-messages__item" onClick={() => onOpen(message)}>
              <strong>{messagePreview(message)}</strong><small>{new Date(message.created_at).toLocaleDateString("ru-RU")}</small>
            </button>
            <button type="button" className="pinned-messages__unpin" aria-label={`Открепить: ${messagePreview(message)}`} disabled={Boolean(busy)} onClick={() => onUnpin(message)}>×</button>
          </li>)}
        </ol>}
      </> : loading && <p className="pinned-messages__hint" role="status">Загрузка закреплённых…</p>}
      {error && <p className="pinned-messages__hint" role="alert">{error}<button type="button" onClick={onRetry}>Повторить</button></p>}
    </section>
  );
}
