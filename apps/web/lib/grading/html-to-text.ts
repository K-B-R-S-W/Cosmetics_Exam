import sanitizeHtml from "sanitize-html";

export function gradingHtmlToText(html: string, maxLength = 2_000): string {
  const plain = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replaceAll("&nbsp;", " ")
    .replace(/\s+/gu, " ")
    .trim();
  return plain.slice(0, maxLength);
}
