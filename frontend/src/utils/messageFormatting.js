const inlineMarks = {
  bold: "**",
  italic: "*",
  strike: "~~",
  code: "`",
  spoiler: "||",
};

export function formatMessageSelection(text, start, end, format) {
  if (format === "quote") {
    const first = text.slice(0, start).lastIndexOf("\n") + 1;
    const nextBreak = text.indexOf("\n", Math.max(start, end - 1));
    const last = nextBreak < 0 ? text.length : nextBreak;
    const lines = text.slice(first, last).split("\n");
    const quoted = lines.every((line) => line.startsWith("> "));
    const quote = lines.map((line) => quoted ? line.slice(2) : `> ${line}`).join("\n");
    return { text: text.slice(0, first) + quote + text.slice(last), start: first, end: first + quote.length };
  }

  const mark = inlineMarks[format];
  if (format === "spoiler" && start !== end && text[start - 1] === "`" && text[end] === "`") {
    start -= 1;
    end += 1;
  }
  const selected = text.slice(start, end);
  if (!selected.trim() && start !== end) return { text, start, end };

  const leading = selected.match(/^\s*/)[0].length;
  const trailing = selected.match(/\s*$/)[0].length;
  start += leading;
  end -= trailing;

  const before = text.slice(0, start);
  const after = text.slice(end);
  const content = text.slice(start, end);
  const multiline = content.includes("\n");
  const hasMarks = content && !multiline && before.endsWith(mark) && after.startsWith(mark);
  const hasItalic = format !== "italic" || (
    before.match(/\**$/)[0].length % 2 === 1 && after.match(/^\**/)[0].length % 2 === 1
  );
  if (hasMarks && hasItalic) {
    return {
      text: before.slice(0, -mark.length) + content + after.slice(mark.length),
      start: start - mark.length,
      end: end - mark.length,
    };
  }

  if (multiline) {
    const formatted = content.replace(/\S[^\r\n]*[^\s]|\S/g, (line) => mark + line + mark);
    return { text: before + formatted + after, start, end: start + formatted.length };
  }
  return { text: before + mark + content + mark + after, start: start + mark.length, end: end + mark.length };
}
