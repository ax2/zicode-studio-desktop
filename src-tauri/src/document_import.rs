//! Document import: convert PDF and DOCX files into readable Markdown.

use base64::Engine;
use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentImportRequest {
    pub document: String,
    #[serde(default)]
    pub title: Option<String>,
    /// Optional explicit kind: "pdf" or "docx". Detected automatically when omitted.
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentImportResult {
    pub ok: bool,
    pub markdown: String,
    pub title: String,
    pub file_name: String,
    pub kind: String,
    pub char_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DocumentKind {
    Pdf,
    Docx,
}

fn decode_document(input: &str, workspace_root: &Path) -> Result<Vec<u8>, String> {
    if let Some(payload) = input.strip_prefix("data:") {
        let body = payload
            .split_once(',')
            .map(|(_, body)| body)
            .ok_or_else(|| "Invalid data URL".to_string())?;
        return base64::engine::general_purpose::STANDARD
            .decode(body)
            .map_err(|error| format!("Invalid base64 document: {error}"));
    }
    let path = if Path::new(input).is_absolute() {
        PathBuf::from(input)
    } else {
        workspace_root.join(input)
    };
    std::fs::read(&path)
        .map_err(|error| format!("Cannot read document {}: {error}", path.display()))
}

fn detect_kind(bytes: &[u8]) -> Result<DocumentKind, String> {
    if bytes.starts_with(b"%PDF") {
        return Ok(DocumentKind::Pdf);
    }
    // DOCX is a ZIP container; the local file header magic is "PK\x03\x04".
    if bytes.starts_with(b"PK\x03\x04") {
        return Ok(DocumentKind::Docx);
    }
    Err("Unsupported document type; expected PDF or DOCX".to_string())
}

fn pdf_to_markdown(bytes: &[u8]) -> Result<String, String> {
    let text = pdf_extract::extract_text_from_mem(bytes)
        .map_err(|error| format!("Cannot extract PDF text: {error}"))?;
    Ok(normalize_pdf_text(&text))
}

fn normalize_pdf_text(text: &str) -> String {
    // pdf-extract separates pages with form-feed characters. Turn each page into
    // blank-line separated blocks and collapse the vertical whitespace that is
    // common in layout-preserving extraction.
    let pages: Vec<String> = text
        .split('\u{c}')
        .map(|page| {
            page.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .filter(|page| !page.trim().is_empty())
        .collect();
    pages.join("\n\n").trim().to_string()
}

fn heading_level(style: Option<&str>) -> u8 {
    let style = style.unwrap_or("");
    let digit = style
        .strip_prefix("Heading")
        .or_else(|| style.strip_prefix("heading"))
        .and_then(|value| value.chars().next())
        .and_then(|ch| ch.to_digit(10));
    digit.map(|value| value.clamp(1, 6) as u8).unwrap_or(0)
}

fn docx_to_markdown(bytes: &[u8]) -> Result<String, String> {
    let archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("Cannot open DOCX archive: {error}"))?;
    let mut archive = archive;
    let mut document_xml = String::new();
    {
        let mut file = archive
            .by_name("word/document.xml")
            .map_err(|error| format!("Cannot locate word/document.xml: {error}"))?;
        std::io::Read::read_to_string(&mut file, &mut document_xml)
            .map_err(|error| format!("Cannot read word/document.xml: {error}"))?;
    }
    Ok(parse_docx_xml(&document_xml))
}

fn parse_docx_xml(xml: &str) -> String {
    let mut reader = Reader::from_str(xml);
    let mut output = String::new();
    let mut in_paragraph = false;
    let mut in_text_run = false;
    let mut paragraph_text = String::new();
    let mut paragraph_style: Option<String> = None;
    let mut buffer = Vec::new();

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(element)) => match element.local_name().as_ref() {
                b"p" => {
                    in_paragraph = true;
                    paragraph_text.clear();
                    paragraph_style = None;
                }
                b"t" => in_text_run = true,
                _ => {}
            },
            Ok(Event::Empty(element)) => {
                if element.local_name().as_ref() == b"pStyle" {
                    for attribute in element.attributes().flatten() {
                        if attribute.key.local_name().as_ref() == b"val" {
                            paragraph_style = String::from_utf8(attribute.value.to_vec())
                                .ok()
                                .map(|value| value.trim().to_string());
                        }
                    }
                }
            }
            Ok(Event::Text(text)) => {
                if in_paragraph && in_text_run {
                    if let Ok(value) = text.unescape() {
                        paragraph_text.push_str(&value);
                    }
                }
            }
            Ok(Event::End(element)) => match element.local_name().as_ref() {
                b"t" => in_text_run = false,
                b"p" => {
                    in_paragraph = false;
                    let trimmed = paragraph_text.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    let level = heading_level(paragraph_style.as_deref());
                    if level > 0 {
                        output.push_str(&"#".repeat(level as usize));
                        output.push(' ');
                        output.push_str(trimmed);
                        output.push('\n');
                    } else {
                        output.push_str(trimmed);
                        output.push_str("\n\n");
                    }
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buffer.clear();
    }

    output.trim().to_string()
}

fn fallback_title(request_title: Option<&str>, file_name: &str, markdown: &str) -> String {
    if let Some(title) = request_title.filter(|value| !value.trim().is_empty()) {
        return title.trim().to_string();
    }
    for line in markdown.lines() {
        let trimmed = line.trim_start_matches('#').trim();
        if !trimmed.is_empty() {
            return truncated(trimmed, 120);
        }
    }
    let stem = file_name
        .rsplit_once('.')
        .map(|(stem, _)| stem)
        .unwrap_or(file_name);
    truncated(stem, 120)
}

fn truncated(value: &str, max_chars: usize) -> String {
    let mut result: String = value.chars().take(max_chars).collect();
    if value.chars().count() > max_chars {
        result.push('…');
    }
    result
}

pub fn import(
    request: &DocumentImportRequest,
    workspace_root: &Path,
) -> Result<DocumentImportResult, String> {
    let bytes = decode_document(&request.document, workspace_root)?;
    let kind = if let Some(explicit) = request.kind.as_deref() {
        match explicit.to_ascii_lowercase().as_str() {
            "pdf" => DocumentKind::Pdf,
            "docx" | "doc" => DocumentKind::Docx,
            other => return Err(format!("Unsupported document kind: {other}")),
        }
    } else {
        detect_kind(&bytes)?
    };

    let (markdown, kind_name) = match kind {
        DocumentKind::Pdf => (pdf_to_markdown(&bytes)?, "pdf"),
        DocumentKind::Docx => (docx_to_markdown(&bytes)?, "docx"),
    };
    let file_name = request
        .document
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("document")
        .to_string();
    let title = fallback_title(request.title.as_deref(), &file_name, &markdown);
    let char_count = markdown.chars().count();

    Ok(DocumentImportResult {
        ok: true,
        markdown,
        title,
        file_name,
        kind: kind_name.to_string(),
        char_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_pdf_page_breaks() {
        let text = "First line\n\nsecond line\u{c}second page line\n";
        let markdown = normalize_pdf_text(text);
        assert!(markdown.starts_with("First line\nsecond line"));
        assert!(markdown.contains("\n\nsecond page line"));
    }

    #[test]
    fn parses_docx_headings_and_paragraphs() {
        let xml = r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
            <w:body>
                <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Introduction</w:t></w:r></w:p>
                <w:p><w:r><w:t>Hello</w:t></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r></w:p>
            </w:body>
        </w:document>"#;
        let markdown = parse_docx_xml(xml);
        assert!(markdown.starts_with("# Introduction"));
        assert!(markdown.contains("Hello world"));
    }

    #[test]
    fn detects_pdf_and_docx_magic() {
        assert_eq!(detect_kind(b"%PDF-1.7").unwrap(), DocumentKind::Pdf);
        assert_eq!(detect_kind(b"PK\x03\x04").unwrap(), DocumentKind::Docx);
        assert!(detect_kind(b"not-a-doc").is_err());
    }

    #[test]
    fn derives_a_title_from_the_first_heading() {
        let markdown = "# Project roadmap\n\nSome body text";
        let title = fallback_title(None, "roadmap.docx", markdown);
        assert_eq!(title, "Project roadmap");
    }
}
