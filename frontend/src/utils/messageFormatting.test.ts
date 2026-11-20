import { describe, expect, it } from "vitest";
import { formatMessageSelection } from "./messageFormatting";
import { parseMessageMarkdown } from "./messageMarkdown";

describe("message formatting", () => {
  it("leaves spaces outside the formatted selection", () => {
    expect(formatMessageSelection("до слово после", 2, 9, "bold"))
      .toEqual({ text: "до **слово** после", start: 5, end: 10 });
  });

  it("can combine and toggle bold and italic on the same selection", () => {
    const italic = formatMessageSelection("**слово**", 2, 7, "italic");
    expect(italic).toEqual({ text: "***слово***", start: 3, end: 8 });
    expect(parseMessageMarkdown(italic.text).html).toBe("<p><strong><em>слово</em></strong></p>");
    expect(formatMessageSelection(italic.text, italic.start, italic.end, "italic"))
      .toEqual({ text: "**слово**", start: 2, end: 7 });
  });

  it("quotes the selected lines while preserving adjacent lines", () => {
    const quote = formatMessageSelection("До\nПервая\nВторая\nПосле", 5, 13, "quote");
    expect(quote.text).toBe("До\n> Первая\n> Вторая\nПосле");
    expect(formatMessageSelection(quote.text, quote.start, quote.end, "quote").text)
      .toBe("До\nПервая\nВторая\nПосле");
  });

  it("hides existing inline code and escapes HTML inside the spoiler", () => {
    const format = formatMessageSelection("`<script>`", 1, 9, "spoiler");
    expect(format.text).toBe("||`<script>`||");
    expect(parseMessageMarkdown(format.text).html).toContain("hidden><code>&lt;script&gt;</code>");
  });
});
