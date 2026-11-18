import { useEffect, useRef, useState } from "react";
import { polls, translateApiError } from "../api";

export default function CreatePollModal({ chatId, threadRootId, onCreated, onClose }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState([{ id: 1, text: "" }, { id: 2, text: "" }]);
  const nextId = useRef(3);
  const [anonymous, setAnonymous] = useState(true);
  const [allowRetract, setAllowRetract] = useState(true);
  const [quiz, setQuiz] = useState(false);
  const [correctId, setCorrectId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef(null);
  const busyRef = useRef(false);
  const closeRef = useRef(onClose);
  const aliveRef = useRef(true);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    aliveRef.current = true;
    const previousFocus = document.activeElement;
    const form = formRef.current;
    form.querySelector("textarea")?.focus();
    const handleKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); if (!busyRef.current) closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = form.querySelectorAll("button:not(:disabled), input:not(:disabled), textarea:not(:disabled)");
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { aliveRef.current = false; document.removeEventListener("keydown", handleKey); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (busyRef.current) return;
    const texts = options.map((option) => option.text.trim());
    if (!question.trim() || texts.some((text) => !text)) { setError("Заполните вопрос и все варианты ответа."); return; }
    if (new Set(texts.map((text) => text.toLocaleLowerCase())).size !== texts.length) { setError("Варианты ответа не должны повторяться."); return; }
    const correctIndex = options.findIndex((option) => option.id === correctId);
    if (quiz && correctIndex < 0) { setError("Отметьте правильный ответ для викторины."); return; }
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const message = await polls.createPoll(chatId, {
        question: question.trim(), options: texts, is_anonymous: anonymous,
        allow_retract: allowRetract, is_quiz: quiz,
        correct_option_index: quiz ? correctIndex : null, thread_root_id: threadRootId || null,
      });
      if (aliveRef.current) onCreated(message);
    } catch (failure) {
      if (aliveRef.current) setError(translateApiError(failure, "Не удалось создать опрос"));
    } finally { busyRef.current = false; if (aliveRef.current) setBusy(false); }
  };

  return <div className="modal-backdrop poll-create-backdrop" onClick={() => { if (!busyRef.current) onClose(); }}>
    <form ref={formRef} className="poll-create" role="dialog" aria-modal="true" aria-labelledby="poll-create-title" onSubmit={submit} onClick={(event) => event.stopPropagation()}>
      <header className="poll-create__header"><div><span>Спросите участников</span><h2 id="poll-create-title">{quiz ? "Новая викторина" : "Новый опрос"}</h2></div><button type="button" className="poll-create__close" aria-label="Закрыть создание опроса" disabled={busy} onClick={onClose}>×</button></header>
      <div className="poll-create__body">
        <div className="poll-create__modes" role="group" aria-label="Тип опроса"><button type="button" aria-pressed={!quiz} disabled={busy} onClick={() => setQuiz(false)}>Опрос</button><button type="button" aria-pressed={quiz} disabled={busy} onClick={() => setQuiz(true)}>Викторина</button></div>
        <label className="poll-create__question">Вопрос<textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={300} rows={2} placeholder="Что хотите узнать?" disabled={busy} /></label>
        <div className="poll-create__options-heading"><strong>Варианты ответа</strong><span>{options.length} / 10</span></div>
        {quiz && <p className="poll-create__hint">Отметьте один правильный вариант. Участники увидят его после ответа.</p>}
        <div className="poll-create__options">
          {options.map((option, index) => <div key={option.id} className={`poll-create__option${quiz && correctId === option.id ? " is-correct" : ""}`}>
            {quiz ? <input type="radio" name="correct-poll-option" aria-label={`Правильный ответ: вариант ${index + 1}`} checked={correctId === option.id} disabled={busy} onChange={() => setCorrectId(option.id)} /> : <span>{index + 1}</span>}
            <input type="text" aria-label={`Вариант ${index + 1}`} placeholder={`Вариант ${index + 1}`} maxLength={150} value={option.text} disabled={busy} onChange={(event) => setOptions((current) => current.map((item) => item.id === option.id ? { ...item, text: event.target.value } : item))} />
            <button type="button" aria-label={`Убрать вариант ${index + 1}`} disabled={busy || options.length <= 2} onClick={() => { setOptions((current) => current.filter((item) => item.id !== option.id)); if (correctId === option.id) setCorrectId(null); }}>×</button>
          </div>)}
        </div>
        <button type="button" className="poll-create__add" disabled={busy || options.length >= 10} onClick={() => { const id = nextId.current++; setOptions((current) => [...current, { id, text: "" }]); }}>＋ Добавить вариант</button>
        <div className="poll-create__settings">
          <label><span><strong>Анонимное голосование</strong><small>{anonymous ? "Имена проголосовавших скрыты" : "Все увидят, кто за что проголосовал"}</small></span><input type="checkbox" role="switch" aria-label="Анонимное голосование" checked={anonymous} disabled={busy} onChange={(event) => setAnonymous(event.target.checked)} /><span className="poll-create__switch" aria-hidden="true" /></label>
          <label><span><strong>Разрешить отмену ответа</strong><small>{allowRetract ? "Можно отменить голос или выбрать другой вариант" : "Первый ответ окончательный, изменить его нельзя"}</small></span><input type="checkbox" role="switch" aria-label="Разрешить отмену ответа" checked={allowRetract} disabled={busy} onChange={(event) => setAllowRetract(event.target.checked)} /><span className="poll-create__switch" aria-hidden="true" /></label>
        </div>
        {error && <p className="poll-create__error" role="alert">{error}</p>}
      </div>
      <footer className="poll-create__footer"><span>Выбор одного варианта</span><button type="submit" disabled={busy}>{busy ? "Создание…" : quiz ? "Создать викторину" : "Создать опрос"}</button></footer>
    </form>
  </div>;
}
