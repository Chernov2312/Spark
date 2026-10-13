const FORMATS = [
  { id: "bold", label: "Ж", title: "Жирный (Ctrl+B)", wrap: ["**", "**"] },
  {
    id: "italic",
    label: "К",
    title: "Курсив (Ctrl+I)",
    wrap: ["*", "*"],
    italic: true,
  },
  {
    id: "strike",
    label: "S",
    title: "Зачёркнутый",
    wrap: ["~~", "~~"],
    strike: true,
  },
  {
    id: "code",
    label: "</>",
    title: "Моноширинный",
    wrap: ["`", "`"],
    mono: true,
  },
  { id: "quote", label: "❝", title: "Цитата", wrap: ["> ", ""] },
];

export default function FormatToolbar({ onFormat, visible }) {
  if (!visible) return null;

  return (
    <div className="format-toolbar" onMouseDown={(e) => e.preventDefault()}>
      {FORMATS.map((f) => (
        <button
          key={f.id}
          type="button"
          className={`format-toolbar__btn format-toolbar__btn--${f.id}`}
          title={f.title}
          onClick={() => onFormat(f.wrap[0], f.wrap[1])}
        >
          <span
            style={{
              fontStyle: f.italic ? "italic" : "normal",
              textDecoration: f.strike ? "line-through" : "none",
              fontFamily: f.mono ? "Consolas, monospace" : "inherit",
              fontWeight: f.id === "bold" ? 800 : 600,
            }}
          >
            {f.label}
          </span>
        </button>
      ))}
    </div>
  );
}
