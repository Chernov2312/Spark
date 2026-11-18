import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { polls, translateApiError } from "../api";

function voteCount(count) {
  const last = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  return `${count} ${!teen && last === 1 ? "голос" : !teen && last >= 2 && last <= 4 ? "голоса" : "голосов"}`;
}

/**
 * @param {{ pollId: string, version?: number, refreshKey?: number,
 *   menuTarget?: Element | null, onCloseMenu?: () => void }} props
 */
export default function PollCard({ pollId, version = 0, refreshKey = 0, menuTarget = null, onCloseMenu }) {
  const [poll, setPoll] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const aliveRef = useRef(true);
  const busyRef = useRef(false);
  const apply = (data) => setPoll((previous) => !previous || data.version >= previous.version ? data : previous);

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const read = async (attempt = 0) => {
      try {
        const data = await polls.getPoll(pollId);
        if (cancelled) return;
        // An event can arrive just before the publishing transaction commits.
        if (data.version < version && attempt < 3) {
          timer = setTimeout(() => read(attempt + 1), 100 * (attempt + 1));
          return;
        }
        if (data.version < version) throw new Error("Stale poll response");
        setError("");
        apply(data);
      } catch (failure) {
        if (!cancelled) setError(translateApiError(failure, "Не удалось загрузить опрос"));
      }
    };
    read();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pollId, version, refreshKey, retry]);

  const submit = async (optionId) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const data = optionId ? await polls.vote(pollId, optionId) : await polls.retractVote(pollId);
      if (aliveRef.current) apply(data);
    } catch (failure) {
      if (aliveRef.current) setError(translateApiError(failure, "Не удалось сохранить ответ"));
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setBusy(false);
    }
  };

  return <section className="poll-card" aria-label={poll?.is_quiz ? "Викторина" : "Опрос"} aria-busy={busy}>
    {poll ? <>
      <div className="poll-card__eyebrow"><span aria-hidden="true">▥</span>{poll.is_quiz ? "Викторина" : "Опрос"}<span className="poll-card__privacy">{poll.is_anonymous ? "Анонимно" : "Открыто"}</span></div>
      <h3>{poll.question}</h3>
      <p className="poll-card__hint">Один вариант · {poll.allow_retract ? "Можно отменить ответ" : "Без отмены ответа"}</p>
      <div className="poll-card__options">
        {poll.options.map((option) => {
          const selected = option.id === poll.my_option_id;
          const correct = poll.correct_option_id === option.id;
          const wrong = selected && poll.correct_option_id && !correct;
          const percent = poll.total_votes ? Math.round(option.votes_count / poll.total_votes * 100) : 0;
          return <div key={option.id}>
            <button type="button" className={`poll-card__option${selected ? " is-selected" : ""}${correct ? " is-correct" : ""}${wrong ? " is-wrong" : ""}`} aria-pressed={selected} disabled={busy || Boolean(poll.my_option_id && !poll.allow_retract)} onClick={() => submit(option.id)}>
              <span className="poll-card__fill" style={{ width: `${percent}%` }} aria-hidden="true" />
              <span className="poll-card__option-content"><span className="poll-card__radio" aria-hidden="true">{correct ? "✓" : wrong ? "×" : selected ? "•" : ""}</span><span className="poll-card__option-text">{option.text}{correct && <small>Правильный ответ</small>}{wrong && <small>Неправильный ответ</small>}</span><span className="poll-card__result">{percent}%<small>{option.votes_count}</small></span></span>
            </button>
            {!poll.is_anonymous && option.voters?.length > 0 && <ul className="poll-card__voters" aria-label={`Проголосовали за ${option.text}`}>
              {option.voters.map((voter) => <li key={voter.id}><strong>{voter.username}</strong><span>@{voter.tag || voter.username}</span></li>)}
            </ul>}
          </div>;
        })}
      </div>
      <div className="poll-card__footer"><span>{voteCount(poll.total_votes)}</span></div>
      {menuTarget && poll.my_option_id && poll.allow_retract && createPortal(
        <button type="button" disabled={busy} onClick={() => { onCloseMenu?.(); submit(null); }}>Отменить голос</button>,
        menuTarget,
      )}
      {poll.my_option_id && poll.is_quiz && poll.correct_option_id && <p className={`poll-card__feedback ${poll.my_option_id === poll.correct_option_id ? "is-correct" : "is-wrong"}`} role="status">{poll.my_option_id === poll.correct_option_id ? "Верно! Вы выбрали правильный ответ." : "Неверно. Правильный ответ отмечен зелёным."}</p>}
      {!poll.allow_retract && poll.my_option_id && <p className="poll-card__note">Ответ сохранён. Изменить или отменить его нельзя.</p>}
      {!poll.is_anonymous && <p className="poll-card__note">Участникам видно, кто выбрал каждый вариант.</p>}
    </> : !error && <p className="poll-card__hint" role="status">Загрузка опроса…</p>}
    {error && <p className="poll-card__error" role="alert">{error}<button type="button" onClick={() => setRetry((value) => value + 1)}>Обновить</button></p>}
  </section>;
}
