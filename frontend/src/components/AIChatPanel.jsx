import { useEffect, useRef, useState } from "react";
import * as aiApi from "../api/ai";

const MESSAGE_LIMITS = [10, 30, 50];

function getErrorMessage(error) {
  const detail = error.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg).filter(Boolean).join("; ");
  }
  return error.message || "Не удалось связаться с ИИ. Попробуйте ещё раз.";
}

export default function AIChatPanel({ chatId, onClose }) {
  const [entries, setEntries] = useState([]);
  const [question, setQuestion] = useState("");
  const [messageLimit, setMessageLimit] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endOfConversationRef = useRef(null);

  useEffect(() => {
    endOfConversationRef.current?.scrollIntoView({ block: "end" });
  }, [entries, busy]);

  const requestSummary = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await aiApi.summarizeChat(chatId, messageLimit);
      setEntries((current) => [
        ...current,
        {
          role: "assistant",
          content: result.summary,
          label: `Сводка последних ${messageLimit} сообщений`,
        },
      ]);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const submitQuestion = async (event) => {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || busy) return;

    setQuestion("");
    setBusy(true);
    setError("");
    setEntries((current) => [...current, { role: "user", content: prompt }]);
    try {
      const result = await aiApi.askChatAssistant(
        chatId,
        prompt,
        messageLimit,
      );
      setEntries((current) => [
        ...current,
        { role: "assistant", content: result.answer },
      ]);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      setQuestion(prompt);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="ai-panel" aria-label="Помощник по чату">
      <header className="ai-panel__header">
        <div>
          <h2>ИИ-помощник</h2>
          <p>Ответы и сводки по сообщениям этого чата</p>
        </div>
        <button
          type="button"
          className="ai-panel__close"
          onClick={onClose}
          aria-label="Закрыть помощника"
        >
          ×
        </button>
      </header>

      <div className="ai-panel__tools">
        <label>
          Сообщений в контексте
          <select
            value={messageLimit}
            onChange={(event) => setMessageLimit(Number(event.target.value))}
            disabled={busy}
          >
            {MESSAGE_LIMITS.map((limit) => (
              <option key={limit} value={limit}>
                {limit}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ai-panel__summary"
          onClick={requestSummary}
          disabled={busy}
        >
          Сделать сводку
        </button>
      </div>

      <div className="ai-panel__conversation" aria-live="polite">
        {entries.length === 0 && (
          <p className="ai-panel__empty">
            Спросите о договорённостях, задачах или попросите краткую сводку.
          </p>
        )}
        {entries.map((entry, index) => (
          <article
            className={`ai-panel__entry ai-panel__entry--${entry.role}`}
            key={`${entry.role}-${index}`}
          >
            {entry.label && <h3>{entry.label}</h3>}
            <p>{entry.content}</p>
          </article>
        ))}
        {busy && <p className="ai-panel__status">ИИ готовит ответ…</p>}
        <div ref={endOfConversationRef} />
      </div>

      {error && (
        <p className="ai-panel__error" role="alert">
          {error}
        </p>
      )}

      <form className="ai-panel__composer" onSubmit={submitQuestion}>
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Спросите что-нибудь по переписке…"
          aria-label="Вопрос ИИ-помощнику"
          maxLength={2000}
          rows={2}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !question.trim()}>
          Отправить
        </button>
      </form>
    </aside>
  );
}
