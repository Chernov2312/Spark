const WEB_URL = "(?:https?://|www\\.)[^\\s<>\"'\\x60*|\\\\]+";
const EMAIL = "[a-z0-9](?:[a-z0-9_.+%-]*[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+[a-z]{2,}";
const PHONE = "(?:\\+(?:[0-9][ \\t\\u00a0().-]*){7,14}[0-9]|[78](?:[ \\t\\u00a0().-]*[0-9]){10})";
const INLINE_TOKENS = new RegExp([
  "\\x60(?<code>[^\\x60]+)\\x60",
  "\\|\\|(?<spoiler>(?:[^|]|\\|(?!\\|))+?)\\|\\|",
  "\\[(?<label>[^\\]]+)\\]\\((?<destination>https?://[^\\s)]+|www\\.[^\\s)]+|mailto:[^\\s)]+|#[^\\s)]*)\\)",
  "(?<![\\p{L}\\p{N}@/])(?<web>" + WEB_URL + ")",
  "(?<![\\p{L}\\p{N}_.@])(?<email>" + EMAIL + ")(?![\\p{L}\\p{N}_-])",
  "(?<![\\p{L}\\p{N}_+])(?<phone>" + PHONE + ")(?![\\p{L}\\p{N}_])",
].join("|"), "giu");

function trimWebUrl(url, precedingText) {
  let result = url.replace(/[.,!?;:…»]+$/u, "");
  const brackets = [["(", ")"], ["[", "]"], ["{", "}"]];
  while (brackets.some(([start, end]) => (
    result.endsWith(end) && result.split(end).length > result.split(start).length
  ))) {
    result = result.slice(0, -1).replace(/[.,!?;:…»]+$/u, "");
  }
  for (const marker of ["__", "~~"]) {
    if (result.endsWith(marker) && precedingText.endsWith(marker)) result = result.slice(0, -2);
  }
  return result;
}

function webHref(value) {
  const href = /^www\./i.test(value) ? "https://" + value : value;
  if (href.includes("\\") || [...href].some((char) => char <= " " || char === "\x7f")) return null;
  try {
    const url = new URL(href);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return href;
  } catch {
    return null;
  }
  return null;
}

function phoneHref(value) {
  const digits = value.replace(/\D/g, "");
  const normalized = !value.startsWith("+") && digits.startsWith("8") ? "7" + digits.slice(1) : digits;
  return "tel:+" + normalized;
}

export function maskMessageSpoilers(value) {
  return value.replace(INLINE_TOKENS, (token, ...args) => args.at(-1).spoiler ? "[Спойлер]" : token);
}

export function renderMessageInline(value, escapeHtml, formatInline, onWebLink) {
  const fragments = [];
  const source = value.replaceAll("\0", "\uFFFD");
  const protectedText = source.replace(INLINE_TOKENS, (token, ...args) => {
    const { code, spoiler, label, destination, web, email, phone } = args.at(-1);
    const index = args.at(-3);
    const addFragment = (html) => "\0" + (fragments.push(html) - 1) + "\0";
    if (code) return addFragment("<code>" + escapeHtml(code) + "</code>");
    if (spoiler) {
      const content = renderMessageInline(spoiler, escapeHtml, formatInline);
      return addFragment('<span class="message-spoiler"><button type="button" class="message-spoiler__toggle" aria-expanded="false">Спойлер</button>' +
        '<span class="message-spoiler__content" hidden>' + content + '</span></span>');
    }

    if (web?.length > 2048 || destination?.length > 2048) return token;
    const webUrl = web ? trimWebUrl(web, source.slice(Math.max(0, index - 2), index)) : destination;
    const href = email ? "mailto:" + email.replaceAll("%", "%25")
      : phone ? phoneHref(phone)
        : /^(?:mailto:|#)/i.test(webUrl) ? webUrl : webHref(webUrl);
    if (!href) return token;
    const external = /^https?:\/\//i.test(href);
    const authority = external ? href.match(/^https?:\/\/([^/?#]+)/i)?.[1] : null;
    if (onWebLink && authority && !authority.includes("%") && href.length <= 2048 && !new URL(href).port) {
      onWebLink(href);
    }
    const kind = external ? "web" : phone ? "phone" : "email";
    const attributes = external ? ' target="_blank" rel="noopener noreferrer"' : "";
    const content = label ? formatInline(escapeHtml(label)) : escapeHtml(web ? webUrl : token);
    const html = '<a class="message-link message-link--' + kind + '" href="' +
      escapeHtml(href) + '"' + attributes + ">" + content + "</a>";
    return addFragment(html) + (web ? web.slice(webUrl.length) : "");
  });
  return formatInline(escapeHtml(protectedText)).replace(/\0(\d+)\0/g, (_token, index) => fragments[index]);
}
