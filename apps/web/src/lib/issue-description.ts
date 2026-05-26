function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
}

export function plainTextToRichTextHtml(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p>${paragraph
          .split("\n")
          .map((line) => escapeHtml(line))
          .join("<br />")}</p>`,
    )
    .join("");
}

export function normalizeIssueDescriptionHtml(
  value: string | null | undefined,
): string | null {
  if (value == null) {
    return null;
  }

  const stripped = value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)=(["'])\s*javascript:[\s\S]*?\2/gi, ' $1="#"')
    .trim();

  if (!stripped) {
    return null;
  }

  if (!/[<>]/.test(stripped)) {
    return plainTextToRichTextHtml(stripped);
  }

  return stripped;
}

export function richTextHtmlToPlainText(
  value: string | null | undefined,
): string {
  if (!value) {
    return "";
  }

  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|blockquote|ul|ol|h[1-6])>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim();
}
