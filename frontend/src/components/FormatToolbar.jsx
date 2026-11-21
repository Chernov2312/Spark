const FORMATS = [
  { id: "bold", label: "Ж", title: "Жирный", keys: "Ctrl+B" },
  { id: "italic", label: "К", title: "Курсив", keys: "Ctrl+I" },
  { id: "strike", label: "З", title: "Зачёркнутый" },
  { id: "code", label: "</>", title: "Моноширинный", keys: "Ctrl+U" },
  { id: "quote", label: "❝", title: "Цитата" },
  { id: "spoiler", label: "Спойлер", title: "Скрытый текст" },
];

export default function FormatToolbar({ onFormat }) {
  return (
    <div className="format-toolbar" role="group" aria-label="Форматирование текста" onPointerDown={(event) => {
      if (event.target.closest("button")) event.preventDefault();
    }}>
      {FORMATS.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`format-toolbar__btn format-toolbar__btn--${f.id}`}
          aria-label={f.title}
          title={f.keys ? `${f.title} (${f.keys})` : f.title}
          onClick={() => onFormat(f.id)}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
