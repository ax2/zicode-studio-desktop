use ego_tree::NodeRef;
use scraper::{ElementRef, Html, Node, Selector};
use std::collections::BTreeSet;

pub(super) struct Document {
    pub title: Option<String>,
    pub markdown: String,
    pub warnings: Vec<String>,
}

pub(super) struct Media {
    pub label: String,
    pub destination: String,
    pub image: bool,
}

pub(super) fn convert(input: &str, mut attachment: impl FnMut(&str) -> Option<Media>) -> Document {
    let html = Html::parse_document(input);
    let title = html
        .select(&Selector::parse("title").expect("title selector"))
        .next()
        .map(|element| element.text().collect::<String>())
        .filter(|title| !title.trim().is_empty());
    let mut context = Converter {
        attachment: &mut attachment,
        warnings: BTreeSet::new(),
    };
    let body = html
        .select(&Selector::parse("body").expect("body selector"))
        .next()
        .unwrap_or_else(|| html.root_element());
    let mut output = String::new();
    context.children(*body, &mut output, 0);
    Document {
        title,
        markdown: output.trim().to_owned(),
        warnings: context.warnings.into_iter().collect(),
    }
}

struct Converter<'a> {
    attachment: &'a mut dyn FnMut(&str) -> Option<Media>,
    warnings: BTreeSet<String>,
}

impl Converter<'_> {
    fn children(&mut self, node: NodeRef<'_, Node>, output: &mut String, depth: usize) {
        if depth > 128 {
            self.warnings
                .insert("Very deeply nested HTML was skipped".into());
            return;
        }
        for child in node.children() {
            match child.value() {
                Node::Text(text) => output.push_str(&escape_text(&text.text)),
                Node::Element(_) => {
                    self.element(ElementRef::wrap(child).expect("element"), output, depth + 1)
                }
                _ => {}
            }
        }
    }

    fn inner(&mut self, element: ElementRef<'_>, depth: usize) -> String {
        let mut text = String::new();
        self.children(*element, &mut text, depth);
        text
    }

    fn element(&mut self, element: ElementRef<'_>, output: &mut String, depth: usize) {
        let name = element.value().name();
        match name {
            "script" | "style" | "template" | "object" | "iframe" | "embed" | "svg"
            | "textarea" | "input" | "audio" | "video" | "source" | "link" | "meta" => {
                self.warnings.insert(format!("Skipped HTML <{name}>"));
            }
            "img" => {
                self.warnings
                    .insert("Skipped image outside the import archive".into());
                if let Some(alt) = element.attr("alt") {
                    output.push_str(&escape_text(alt));
                }
            }
            "en-media" => {
                if let Some(media) = element.attr("hash").and_then(&mut self.attachment) {
                    if media.image {
                        output.push('!');
                    }
                    output.push_str(&format!(
                        "[{}]({})",
                        escape_text(&media.label),
                        media.destination
                    ));
                } else {
                    self.warnings
                        .insert("Some Evernote media could not be imported".into());
                }
                // HTML parsers can place following siblings inside an ENML
                // extension tag because it uses XML self-closing syntax.
                self.children(*element, output, depth);
            }
            "en-crypt" => {
                self.warnings
                    .insert("Encrypted Evernote content was skipped".into());
                output.push_str("[Encrypted content]");
            }
            "en-todo" => {
                output.push_str(if element.attr("checked") == Some("true") {
                    "[x] "
                } else {
                    "[ ] "
                });
                self.children(*element, output, depth);
            }
            "a" => {
                let label = self.inner(element, depth);
                if let Some(href) = element.attr("href").and_then(safe_link) {
                    output.push_str(&format!("[{label}](<{href}>)"));
                } else {
                    if element.attr("href").is_some() {
                        self.warnings.insert("A link could not be preserved".into());
                    }
                    output.push_str(&label);
                }
            }
            "br" => output.push('\n'),
            "hr" => output.push_str("\n\n---\n\n"),
            "b" | "strong" | "i" | "em" | "s" | "del" => {
                let marker = match name {
                    "b" | "strong" => "**",
                    "i" | "em" => "*",
                    _ => "~~",
                };
                let inner = self.inner(element, depth);
                if !inner.trim().is_empty() {
                    output.push_str(marker);
                    output.push_str(&inner);
                    output.push_str(marker);
                }
            }
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                let heading = self.inner(element, depth);
                let level = usize::from(name.as_bytes()[1] - b'0');
                output.push_str(&format!("\n\n{} {}\n\n", "#".repeat(level), heading.trim()));
            }
            "pre" | "code" => {
                let text = element.text().collect::<String>();
                let delimiter = delimiter_for(&text, if name == "pre" { 3 } else { 1 });
                if name == "pre" {
                    output.push_str(&format!("\n\n{delimiter}\n{text}\n{delimiter}\n\n"));
                } else {
                    output.push_str(&format!("{delimiter} {text} {delimiter}"));
                }
            }
            "ul" | "ol" => {
                output.push_str("\n\n");
                for (index, child) in element
                    .children()
                    .filter_map(ElementRef::wrap)
                    .filter(|child| child.value().name() == "li")
                    .enumerate()
                {
                    let inner = self.inner(child, depth);
                    let marker = if name == "ul" {
                        "- ".into()
                    } else {
                        format!("{}. ", index + 1)
                    };
                    let continuation = "\n".to_owned() + &" ".repeat(marker.len());
                    output.push_str(&marker);
                    output.push_str(&inner.trim().replace('\n', &continuation));
                    output.push('\n');
                }
                output.push('\n');
            }
            "table" => self.table(element, output, depth),
            "blockquote" => {
                output.push_str("\n\n");
                for line in self.inner(element, depth).trim().lines() {
                    output.push_str("> ");
                    output.push_str(line);
                    output.push('\n');
                }
                output.push('\n');
            }
            "p" | "div" | "section" | "article" | "figure" | "figcaption" => {
                output.push_str("\n\n");
                self.children(*element, output, depth);
                output.push_str("\n\n");
            }
            _ => self.children(*element, output, depth),
        }
    }

    fn table(&mut self, table: ElementRef<'_>, output: &mut String, depth: usize) {
        let rows = table
            .children()
            .filter_map(ElementRef::wrap)
            .flat_map(|section| {
                if section.value().name() == "tr" {
                    vec![section]
                } else if matches!(section.value().name(), "thead" | "tbody" | "tfoot") {
                    section
                        .children()
                        .filter_map(ElementRef::wrap)
                        .filter(|row| row.value().name() == "tr")
                        .collect()
                } else {
                    Vec::new()
                }
            })
            .map(|row| {
                row.children()
                    .filter_map(ElementRef::wrap)
                    .filter(|cell| matches!(cell.value().name(), "td" | "th"))
                    .map(|cell| {
                        if cell.attr("rowspan").is_some() || cell.attr("colspan").is_some() {
                            self.warnings
                                .insert("Merged table cells were flattened".into());
                        }
                        self.inner(cell, depth)
                            .split_whitespace()
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .collect::<Vec<_>>()
            })
            .filter(|row| !row.is_empty())
            .collect::<Vec<_>>();
        let width = rows.iter().map(Vec::len).max().unwrap_or(0);
        if width == 0 {
            return;
        }
        // Keep ragged tables readable without padding every row to a hostile width.
        if width > 64 || rows.len().saturating_mul(width) > 20_000 {
            self.warnings
                .insert("Wide table was converted to text".into());
            for row in rows {
                output.push_str(&row.join(" · "));
                output.push('\n');
            }
            return;
        }
        output.push_str("\n\n");
        for (index, mut row) in rows.into_iter().enumerate() {
            row.resize(width, String::new());
            output.push_str("| ");
            output.push_str(&row.join(" | "));
            output.push_str(" |\n");
            if index == 0 {
                output.push('|');
                for _ in 0..width {
                    output.push_str(" --- |");
                }
                output.push('\n');
            }
        }
        output.push('\n');
    }
}

pub(super) fn escape_text(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(
            c,
            '\\' | '*' | '_' | '[' | ']' | '<' | '>' | '~' | '|' | '\u{60}'
        ) {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

fn safe_link(href: &str) -> Option<String> {
    let url = reqwest::Url::parse(href).ok()?;
    if !matches!(url.scheme(), "http" | "https" | "mailto") {
        return None;
    }
    Some(url.as_str().replace('<', "%3C").replace('>', "%3E"))
}

fn delimiter_for(content: &str, minimum: usize) -> String {
    let mut run = 0;
    let mut longest = 0;
    for c in content.chars() {
        if c == '\u{60}' {
            run += 1;
            longest = longest.max(run);
        } else {
            run = 0;
        }
    }
    "\u{60}".repeat(minimum.max(longest + 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_structure_and_external_links_without_loading_images() {
        let result = convert(
            r#"<title>导入文档</title><h1>笔记</h1><p><b>粗体</b> <a href="https://example.com/page">阅读</a>
            <img src="https://example.com/track.gif" alt="图片说明"><img src="file:///test">
            <script>omit()</script>&lt;img src=&quot;https://bad.example&quot;&gt;</p>
            <table><tr><th>甲</th><th>乙</th></tr><tr><td>一</td><td>二</td></tr></table>"#,
            |_| None,
        );
        assert_eq!(result.title.as_deref(), Some("导入文档"));
        assert!(result.markdown.contains("# 笔记"));
        assert!(result
            .markdown
            .contains("**粗体** [阅读](<https://example.com/page>)"));
        assert!(result.markdown.contains("图片说明"));
        assert!(result.markdown.contains("\\<img"));
        assert!(result.markdown.contains("| 一 | 二 |"));
        assert!(!result.markdown.contains("track.gif"));
        assert!(!result.markdown.contains("omit()"));
        assert_eq!(result.warnings.len(), 2);
    }
}
