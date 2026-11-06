// The Studio Markdown renderer closes a code block at the first triple
// backtick, even inside JSON strings. Escaping each backtick as a JSON Unicode
// escape preserves the parsed value and prevents it from closing the fence.
export function jsonReportMarkdown(json) {
  return `\`\`\`json\n${json.replace(/`/g, "\\u0060")}\n\`\`\`\n`;
}
