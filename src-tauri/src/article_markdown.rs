//! Minimal Markdown-to-HTML renderer for the WeChat draft body. It is
//! intentionally small (headings, paragraphs, lists, code blocks, quotes,
//! emphasis, links and images) and does not aim to replace a full Astro build.

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn render_inline(text: &str) -> String {
    let text = escape_html(text);
    // Images first so their `![alt](url)` syntax is not split by link handling.
    let mut out = String::new();
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'!' && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            if let Some(close) = text[i + 2..].find("](") {
                let close = i + 2 + close;
                if let Some(end) = text[close + 1..].find(')') {
                    let end = close + 1 + end;
                    let alt = &text[i + 2..close];
                    let url = &text[close + 2..end];
                    out.push_str(&format!(
                        "<img src=\"{}\" alt=\"{}\">",
                        url,
                        escape_html(alt)
                    ));
                    i = end + 1;
                    continue;
                }
            }
        }
        if bytes[i] == b'[' {
            if let Some(close) = text[i + 1..].find("](") {
                let close = i + 1 + close;
                if let Some(end) = text[close + 1..].find(')') {
                    let end = close + 1 + end;
                    let label = &text[i + 1..close];
                    let url = &text[close + 2..end];
                    out.push_str(&format!("<a href=\"{}\">{}</a>", url, render_inline(label)));
                    i = end + 1;
                    continue;
                }
            }
        }
        if bytes[i] == b'`' {
            if let Some(close) = text[i + 1..].find('`') {
                let close = i + 1 + close;
                let code = &text[i + 1..close];
                out.push_str(&format!("<code>{}</code>", escape_html(code)));
                i = close + 1;
                continue;
            }
        }
        if bytes[i] == b'*' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            if let Some(close) = text[i + 2..].find("**") {
                let close = i + 2 + close;
                let inner = &text[i + 2..close];
                out.push_str(&format!("<strong>{}</strong>", render_inline(inner)));
                i = close + 2;
                continue;
            }
        }
        if bytes[i] == b'*' {
            if let Some(close) = text[i + 1..].find('*') {
                let close = i + 1 + close;
                let inner = &text[i + 1..close];
                out.push_str(&format!("<em>{}</em>", render_inline(inner)));
                i = close + 1;
                continue;
            }
        }
        // Copy a UTF-8 character.
        let ch = text[i..].chars().next().unwrap_or(' ');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn is_table_separator(line: &str) -> bool {
    let trimmed = line.trim();
    if !trimmed.contains('|') {
        return false;
    }
    trimmed
        .split('|')
        .filter(|cell| !cell.trim().is_empty())
        .all(|cell| {
            let cell = cell.trim();
            cell.chars().all(|c| c == '-' || c == ':' || c == ' ')
        })
}

fn split_table_row(line: &str) -> Vec<String> {
    let trimmed = line.trim().trim_start_matches('|').trim_end_matches('|');
    trimmed
        .split('|')
        .map(|cell| cell.trim().to_string())
        .collect::<Vec<_>>()
}

pub fn markdown_to_html(markdown: &str) -> String {
    let markdown = markdown.replace("\r\n", "\n").replace("<!-- more -->", "");
    let mut html = String::new();
    let mut in_code = false;
    let mut code_buffer = String::new();
    let mut in_paragraph = false;
    let mut list_stack: Vec<bool> = Vec::new();

    fn close_paragraph(html: &mut String, in_paragraph: &mut bool) {
        if *in_paragraph {
            html.push_str("</p>");
            *in_paragraph = false;
        }
    }

    fn close_lists(html: &mut String, list_stack: &mut Vec<bool>) {
        while let Some(ordered) = list_stack.pop() {
            html.push_str(if ordered { "</ol>" } else { "</ul>" });
        }
    }

    let lines: Vec<&str> = markdown.lines().collect();
    let mut index = 0usize;
    while index < lines.len() {
        let raw = lines[index];
        let line = raw.trim_end();
        if line.trim_start().starts_with("```") {
            if in_code {
                let lang = line.trim_start().trim_start_matches("```").trim();
                let language = if lang.is_empty() {
                    String::new()
                } else {
                    format!("<span class=\"code-language\">{}</span>", escape_html(lang))
                };
                close_paragraph(&mut html, &mut in_paragraph);
                close_lists(&mut html, &mut list_stack);
                html.push_str(&format!(
                    "<pre>{language}<code>{}</code></pre>",
                    escape_html(&code_buffer)
                ));
                code_buffer.clear();
                in_code = false;
            } else {
                close_paragraph(&mut html, &mut in_paragraph);
                close_lists(&mut html, &mut list_stack);
                in_code = true;
            }
            index += 1;
            continue;
        }
        if in_code {
            code_buffer.push_str(line);
            code_buffer.push('\n');
            index += 1;
            continue;
        }
        if line.trim().is_empty() {
            close_paragraph(&mut html, &mut in_paragraph);
            close_lists(&mut html, &mut list_stack);
            index += 1;
            continue;
        }
        if line.trim_start().starts_with('|')
            && index + 1 < lines.len()
            && is_table_separator(lines[index + 1])
        {
            close_paragraph(&mut html, &mut in_paragraph);
            close_lists(&mut html, &mut list_stack);
            let header = split_table_row(line);
            let columns = header.len();
            html.push_str("<table><thead><tr>");
            for cell in &header {
                html.push_str(&format!("<th>{}</th>", render_inline(cell)));
            }
            html.push_str("</tr></thead><tbody>");
            let mut next = index + 2;
            while next < lines.len() && lines[next].trim_start().starts_with('|') {
                let row = split_table_row(lines[next].trim_end());
                html.push_str("<tr>");
                for column in 0..columns {
                    let cell = row.get(column).map(String::as_str).unwrap_or("");
                    html.push_str(&format!("<td>{}</td>", render_inline(cell)));
                }
                html.push_str("</tr>");
                next += 1;
            }
            html.push_str("</tbody></table>");
            index = next;
            continue;
        }
        if line.trim_start().starts_with('#') {
            let level = line.trim_start().chars().take_while(|c| *c == '#').count();
            let text = line.trim_start().trim_start_matches('#').trim();
            if !text.is_empty() && level <= 6 {
                close_paragraph(&mut html, &mut in_paragraph);
                close_lists(&mut html, &mut list_stack);
                html.push_str(&format!("<h{level}>{}</h{level}>", render_inline(text)));
                index += 1;
                continue;
            }
        }
        if let Some(quote) = line.strip_prefix('>') {
            close_paragraph(&mut html, &mut in_paragraph);
            close_lists(&mut html, &mut list_stack);
            html.push_str(&format!(
                "<blockquote>{}</blockquote>",
                render_inline(quote.trim_start())
            ));
            index += 1;
            continue;
        }
        if let Some((checked, text)) = line.trim_start().strip_prefix("- [").and_then(|rest| {
            rest.find(']')
                .map(|end| (&rest[..end], rest[end + 1..].trim_start()))
        }) {
            // Task list item: `- [ ] text` or `- [x] text`.
            let checked = matches!(checked.trim(), "x" | "X");
            close_paragraph(&mut html, &mut in_paragraph);
            if !matches!(list_stack.last(), Some(false)) {
                close_lists(&mut html, &mut list_stack);
                list_stack.push(false);
                html.push_str("<ul class=\"task-list\">");
            }
            html.push_str(&format!(
                "<li class=\"task-list-item\"><input type=\"checkbox\" disabled{}> {}</li>",
                if checked { " checked" } else { "" },
                render_inline(text)
            ));
            index += 1;
            continue;
        }
        let unordered = line
            .trim_start()
            .strip_prefix("- ")
            .or_else(|| line.trim_start().strip_prefix("* "))
            .map(|item| (false, item));
        let ordered = {
            let trimmed = line.trim_start();
            let digits = trimmed.chars().take_while(|c| c.is_ascii_digit()).count();
            if digits > 0 && trimmed[digits..].starts_with(". ") {
                Some((true, &trimmed[digits + 2..]))
            } else {
                None
            }
        };
        if let Some((is_ordered, item)) = unordered.or(ordered) {
            close_paragraph(&mut html, &mut in_paragraph);
            let tag = if is_ordered { "ol" } else { "ul" };
            match list_stack.last() {
                Some(last) if *last == is_ordered => {}
                Some(_) => {
                    list_stack.pop();
                    html.push_str(if is_ordered { "</ul>" } else { "</ol>" });
                    list_stack.push(is_ordered);
                    html.push_str(&format!("<{tag}>"));
                }
                None => {
                    list_stack.push(is_ordered);
                    html.push_str(&format!("<{tag}>"));
                }
            }
            html.push_str(&format!("<li>{}</li>", render_inline(item.trim())));
            index += 1;
            continue;
        }
        close_lists(&mut html, &mut list_stack);
        if !in_paragraph {
            html.push_str("<p>");
            in_paragraph = true;
        } else {
            html.push('\n');
        }
        html.push_str(&render_inline(line));
        index += 1;
    }
    if in_code && !code_buffer.is_empty() {
        html.push_str(&format!(
            "<pre><code>{}</code></pre>",
            escape_html(&code_buffer)
        ));
    }
    close_paragraph(&mut html, &mut in_paragraph);
    close_lists(&mut html, &mut list_stack);
    html
}

/// Strip tags from rendered HTML and collapse whitespace, used to derive a
/// plain-text digest when an article has no explicit description.
pub fn html_to_plain_text(html: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    for character in html.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                if !text.is_empty() && !text.ends_with(' ') {
                    text.push(' ');
                }
            }
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    let decoded = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_headings_paragraphs_and_lists() {
        let html = markdown_to_html("# 标题\n\n正文段落 **加粗** 和 `代码`。\n\n- 一\n- 二\n");
        assert!(html.contains("<h1>标题</h1>"));
        assert!(html.contains("<p>正文段落 <strong>加粗</strong> 和 <code>代码</code>。</p>"));
        assert!(html.contains("<ul><li>一</li><li>二</li></ul>"));
    }

    #[test]
    fn renders_code_block_and_links() {
        let html = markdown_to_html("```rust\nlet x = 1;\n```\n\n[链接](https://example.com)");
        assert!(html.contains("<pre>"));
        assert!(html.contains("let x = 1;"));
        assert!(html.contains("<a href=\"https://example.com\">链接</a>"));
    }

    #[test]
    fn extracts_plain_text_from_html() {
        let text = html_to_plain_text("<h1>标题</h1><p>正文 &amp; 内容</p>");
        assert_eq!(text, "标题 正文 & 内容");
    }

    #[test]
    fn renders_markdown_tables() {
        let html = markdown_to_html("| 名称 | 值 |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n");
        assert!(html.contains("<table><thead><tr><th>名称</th><th>值</th></tr></thead><tbody>"));
        assert!(html.contains("<tr><td>a</td><td>1</td></tr>"));
        assert!(html.contains("<tr><td>b</td><td>2</td></tr>"));
    }

    #[test]
    fn renders_task_lists() {
        let html = markdown_to_html("- [ ] 未完成\n- [x] 已完成\n");
        assert!(html.contains("<ul class=\"task-list\">"));
        assert!(html.contains(
            "<li class=\"task-list-item\"><input type=\"checkbox\" disabled> 未完成</li>"
        ));
        assert!(html.contains(
            "<li class=\"task-list-item\"><input type=\"checkbox\" disabled checked> 已完成</li>"
        ));
    }
}
