//! Article store: Astro-format Markdown posts under the global system root.
//! Each post keeps its `wechatDraftMediaId` / `wechatPublishId` in frontmatter
//! so the publishing flow can tell whether a post has already been synced and
//! can update the same WeChat draft instead of creating a duplicate.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleSummary {
    pub slug: String,
    pub title: String,
    pub description: String,
    pub pub_date: Option<String>,
    pub draft: bool,
    pub category: Option<String>,
    pub tags: Vec<String>,
    pub authors: Vec<String>,
    pub hero_image: Option<String>,
    pub wechat_draft_media_id: Option<String>,
    pub wechat_publish_id: Option<String>,
    pub updated_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Article {
    #[serde(flatten)]
    pub summary: ArticleSummary,
    pub markdown: String,
}

#[derive(Debug, Clone)]
enum FmValue {
    Str(String),
    List(Vec<String>),
}

pub fn article_dir(system_root: &Path) -> PathBuf {
    system_root.join("articles").join("blog")
}

/// Translate a WSL Linux path into the Windows-accessible UNC path. On Windows,
/// `PathBuf::from("/home/alex/...")` does not reach the WSL filesystem, so a
/// source directory pasted from the WSL shell must be mapped to
/// `\\wsl.localhost\Ubuntu\home\alex\...`. `/mnt/<drive>/...` maps to the
/// corresponding Windows drive.
pub fn translate_source_dir(input: &str) -> String {
    let trimmed = input.trim();
    #[cfg(windows)]
    {
        if let Some(rest) = trimmed.strip_prefix("/mnt/") {
            let mut chars = rest.chars();
            if let Some(drive) = chars.next() {
                return format!(
                    "{}:{}",
                    drive.to_ascii_uppercase(),
                    chars.as_str().replace('/', "\\")
                );
            }
        }
        if trimmed.starts_with('/') {
            return format!("\\\\wsl.localhost\\Ubuntu{}", trimmed.replace('/', "\\"));
        }
    }
    trimmed.to_string()
}

/// Split a document into (frontmatter_text, body). The frontmatter text is the
/// raw content between the first two `---` fences (without the fences).
fn split_frontmatter(text: &str) -> Option<(String, String)> {
    let normalized = text.replace("\r\n", "\n");
    let start = normalized.strip_prefix("---\n")?;
    let closing = start.find("\n---\n").or_else(|| start.find("\n---"))?;
    let frontmatter = start[..closing].to_string();
    let body_start = closing + "\n---".len();
    let body = start[body_start..].trim_start_matches('\n').to_string();
    Some((frontmatter, body))
}

/// Return just the Markdown body without the frontmatter block.
pub fn markdown_body(markdown: &str) -> String {
    split_frontmatter(markdown)
        .map(|(_, body)| body)
        .unwrap_or_else(|| markdown.to_string())
}

fn unquote(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 {
        let bytes = trimmed.as_bytes();
        let first = bytes[0] as char;
        let last = bytes[trimmed.len() - 1] as char;
        if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
            return trimmed[1..trimmed.len() - 1].to_string();
        }
    }
    trimmed.to_string()
}

fn parse_frontmatter(text: &str) -> HashMap<String, FmValue> {
    let mut values: HashMap<String, FmValue> = HashMap::new();
    let mut current_key: Option<String> = None;
    for raw_line in text.lines() {
        let line = raw_line.trim_end();
        if line.trim().is_empty() {
            continue;
        }
        if let Some(list_item) = line.trim_start().strip_prefix("- ") {
            if let Some(key) = current_key.as_ref() {
                let item = unquote(list_item.trim());
                match values.entry(key.clone()) {
                    std::collections::hash_map::Entry::Occupied(mut entry) => {
                        if let FmValue::List(items) = entry.get_mut() {
                            items.push(item);
                        }
                    }
                    std::collections::hash_map::Entry::Vacant(entry) => {
                        entry.insert(FmValue::List(vec![item]));
                    }
                }
            }
            continue;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            continue;
        }
        if let Some((key, raw_value)) = line.split_once(':') {
            let key = key.trim().to_string();
            let raw_value = raw_value.trim();
            if raw_value.is_empty() {
                current_key = Some(key);
                continue;
            }
            // Inline list like `tags: [a, b]`.
            if raw_value.starts_with('[') && raw_value.ends_with(']') {
                let inner = &raw_value[1..raw_value.len() - 1];
                let items = inner
                    .split(',')
                    .map(unquote)
                    .filter(|item| !item.is_empty())
                    .collect::<Vec<_>>();
                values.insert(key.clone(), FmValue::List(items));
                current_key = None;
                continue;
            }
            values.insert(key.clone(), FmValue::Str(unquote(raw_value)));
            current_key = None;
        }
    }
    values
}

fn str_field(values: &HashMap<String, FmValue>, key: &str) -> Option<String> {
    match values.get(key) {
        Some(FmValue::Str(value)) if !value.trim().is_empty() => Some(value.clone()),
        Some(FmValue::Str(_)) => None,
        Some(FmValue::List(items)) => items
            .first()
            .filter(|item| !item.trim().is_empty())
            .cloned(),
        None => None,
    }
}

fn list_field(values: &HashMap<String, FmValue>, key: &str) -> Vec<String> {
    match values.get(key) {
        Some(FmValue::List(items)) => items.clone(),
        Some(FmValue::Str(value)) => vec![value.clone()],
        None => Vec::new(),
    }
}

fn bool_field(values: &HashMap<String, FmValue>, key: &str) -> bool {
    str_field(values, key)
        .map(|value| matches!(value.to_ascii_lowercase().as_str(), "true" | "yes" | "1"))
        .unwrap_or(false)
}

fn summary_from_markdown(slug: &str, markdown: &str, updated_at_ms: Option<u64>) -> ArticleSummary {
    let values = split_frontmatter(markdown)
        .map(|(fm, _)| parse_frontmatter(&fm))
        .unwrap_or_default();
    ArticleSummary {
        slug: str_field(&values, "slug")
            .or_else(|| str_field(&values, "urlSlug"))
            .unwrap_or_else(|| slug.to_string()),
        title: str_field(&values, "title").unwrap_or_default(),
        description: str_field(&values, "description").unwrap_or_default(),
        pub_date: str_field(&values, "pubDate"),
        draft: bool_field(&values, "draft"),
        category: str_field(&values, "category"),
        tags: list_field(&values, "tags"),
        authors: list_field(&values, "authors"),
        hero_image: str_field(&values, "heroImage"),
        wechat_draft_media_id: str_field(&values, "wechatDraftMediaId"),
        wechat_publish_id: str_field(&values, "wechatPublishId"),
        updated_at_ms,
    }
}

fn file_updated_at_ms(path: &Path) -> Option<u64> {
    fs::metadata(path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

fn walk_markdown_files(system_root: &Path) -> Result<Vec<PathBuf>, String> {
    let dir = article_dir(system_root);
    let mut files = Vec::new();
    let mut stack = vec![dir];
    while let Some(current) = stack.pop() {
        if !current.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&current).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
                files.push(path);
            }
        }
    }
    Ok(files)
}

pub fn list(system_root: &Path) -> Result<Vec<ArticleSummary>, String> {
    let mut articles = Vec::new();
    for path in walk_markdown_files(system_root)? {
        let fallback = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("article");
        let markdown = fs::read_to_string(&path).unwrap_or_default();
        let summary = summary_from_markdown(fallback, &markdown, file_updated_at_ms(&path));
        articles.push(summary);
    }
    articles.sort_by(|a, b| {
        b.pub_date
            .as_deref()
            .cmp(&a.pub_date.as_deref())
            .then_with(|| b.updated_at_ms.cmp(&a.updated_at_ms))
    });
    Ok(articles)
}

fn validate_slug(slug: &str) -> Result<(), String> {
    if slug.is_empty()
        || slug.contains('/')
        || slug.contains('\\')
        || slug.contains("..")
        || slug.chars().any(char::is_control)
    {
        return Err("Article slug is invalid".to_string());
    }
    Ok(())
}

fn resolve_article_path(system_root: &Path, slug: &str) -> Result<PathBuf, String> {
    validate_slug(slug)?;
    let direct = article_dir(system_root).join(format!("{slug}.md"));
    if direct.is_file() {
        return Ok(direct);
    }
    for path in walk_markdown_files(system_root)? {
        let markdown = fs::read_to_string(&path).unwrap_or_default();
        let values = split_frontmatter(&markdown)
            .map(|(frontmatter, _)| parse_frontmatter(&frontmatter))
            .unwrap_or_default();
        let frontmatter_slug = str_field(&values, "slug").or_else(|| str_field(&values, "urlSlug"));
        if frontmatter_slug.as_deref() == Some(slug) {
            return Ok(path);
        }
    }
    Err(format!("Article {slug} does not exist"))
}

pub fn read(system_root: &Path, slug: &str) -> Result<Article, String> {
    let path = resolve_article_path(system_root, slug)?;
    let markdown =
        fs::read_to_string(&path).map_err(|_| format!("Article {slug} does not exist"))?;
    let summary = summary_from_markdown(slug, &markdown, file_updated_at_ms(&path));
    Ok(Article { summary, markdown })
}

pub fn save(system_root: &Path, slug: &str, markdown: &str) -> Result<(), String> {
    let path = match resolve_article_path(system_root, slug) {
        Ok(existing) => existing,
        Err(error) if error.contains("does not exist") => {
            validate_slug(slug)?;
            article_dir(system_root).join(format!("{slug}.md"))
        }
        Err(error) => return Err(error),
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&path, markdown).map_err(|error| error.to_string())?;
    // Keep the frontmatter slug in sync with the file slug so a newly created
    // article with an empty `slug:` field resolves correctly after reload.
    upsert_frontmatter_field(system_root, slug, "slug", slug).ok();
    Ok(())
}

pub fn delete(system_root: &Path, slug: &str) -> Result<bool, String> {
    let path = resolve_article_path(system_root, slug)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

/// Set or replace a scalar frontmatter field without reformatting the rest of
/// the file. Mirrors the reference Python `upsert_frontmatter_field`.
pub fn upsert_frontmatter_field(
    system_root: &Path,
    slug: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    let path = resolve_article_path(system_root, slug)?;
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let normalized = text.replace("\r\n", "\n");
    let Some((frontmatter, body)) = split_frontmatter(&normalized) else {
        return Err("Article has no frontmatter".to_string());
    };
    rewrite_frontmatter(&path, key, value, &frontmatter, &body)
}

fn rewrite_frontmatter(
    path: &Path,
    key: &str,
    value: &str,
    frontmatter: &str,
    body: &str,
) -> Result<(), String> {
    let mut new_frontmatter = String::new();
    let mut replaced = false;
    let lines = frontmatter.lines();
    for line in lines {
        let trimmed = line.trim();
        if let Some((existing_key, _)) = trimmed.split_once(':') {
            if existing_key.trim() == key && !trimmed.starts_with('-') {
                let indent: String = line
                    .chars()
                    .take_while(|c| *c == ' ' || *c == '\t')
                    .collect();
                new_frontmatter.push_str(&format!("{indent}{key}: \"{value}\"\n"));
                replaced = true;
                continue;
            }
        }
        new_frontmatter.push_str(line);
        new_frontmatter.push('\n');
    }
    if !replaced {
        new_frontmatter.push_str(&format!("{key}: \"{value}\"\n"));
    }
    let updated = format!("---\n{new_frontmatter}---\n{body}");
    fs::write(path, updated).map_err(|error| error.to_string())
}

/// Initial sync: copy Astro-format Markdown posts from a local source
/// directory (for example the WSL `astro-site/src/content/blog` path) into the
/// article store. Returns the number of copied posts.
pub fn sync_from_dir(system_root: &Path, source_dir: &str) -> Result<usize, String> {
    let source = PathBuf::from(translate_source_dir(source_dir));
    if !source.is_dir() {
        return Err("Source blog directory does not exist".to_string());
    }
    let destination = article_dir(system_root);
    fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    let mut copied = 0usize;
    let mut stack = vec![source.clone()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            if !path.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("md") {
                continue;
            }
            let relative = path
                .strip_prefix(&source)
                .map_err(|error| error.to_string())?;
            let dest_path = destination.join(relative);
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(&path, &dest_path).map_err(|error| error.to_string())?;
            copied += 1;
        }
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root() -> PathBuf {
        std::env::temp_dir().join(format!("articles-{}", uuid::Uuid::new_v4().simple()))
    }

    const SAMPLE: &str = r#"---
title: "示例文章"
description: "一段描述"
pubDate: "2026-03-25"
slug: "sample-post"
draft: false
category: "随笔"
authors:
  - "Alex Xiang"
tags:
  - "astro"
  - "微信公众号"
heroImage: "/heroes/sample-hero.png"
wechatDraftMediaId: "qAewqDXX"
---

正文内容。
"#;

    #[test]
    fn parses_frontmatter_fields() {
        let summary = summary_from_markdown("sample-post", SAMPLE, None);
        assert_eq!(summary.title, "示例文章");
        assert_eq!(summary.description, "一段描述");
        assert_eq!(summary.slug, "sample-post");
        assert_eq!(summary.tags, vec!["astro", "微信公众号"]);
        assert_eq!(summary.authors, vec!["Alex Xiang"]);
        assert_eq!(
            summary.hero_image.as_deref(),
            Some("/heroes/sample-hero.png")
        );
        assert_eq!(summary.wechat_draft_media_id.as_deref(), Some("qAewqDXX"));
        assert!(!summary.draft);
    }

    #[test]
    fn falls_back_to_file_stem_when_slug_is_empty() {
        let markdown = r#"---
title: ""
description: ""
pubDate: "2026-03-25"
slug: ""
draft: false
---

正文内容。
"#;
        let summary = summary_from_markdown("new-post", markdown, None);
        assert_eq!(summary.slug, "new-post");
    }

    #[test]
    fn save_syncs_the_frontmatter_slug_with_the_file_name() {
        let root = tmp_root();
        let markdown = "---\ntitle: \"\"\nslug: \"\"\ndraft: false\ntags: []\n---\n\n正文";
        save(&root, "my-post", markdown).unwrap();
        let article = read(&root, "my-post").unwrap();
        assert_eq!(article.summary.slug, "my-post");
        assert!(article.markdown.contains("slug: \"my-post\""));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn upserts_wechat_field_without_reformatting() {
        let root = tmp_root();
        save(&root, "sample-post", SAMPLE).unwrap();
        upsert_frontmatter_field(&root, "sample-post", "wechatDraftMediaId", "new-id").unwrap();
        let article = read(&root, "sample-post").unwrap();
        assert_eq!(
            article.summary.wechat_draft_media_id.as_deref(),
            Some("new-id")
        );
        assert!(article.markdown.contains("title: \"示例文章\""));
        assert!(article.markdown.contains("正文内容。"));
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn syncs_markdown_from_source_dir() {
        let root = tmp_root();
        let source = root.join("source");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("a.md"), SAMPLE).unwrap();
        fs::write(source.join("b.md"), SAMPLE).unwrap();
        fs::write(source.join("ignore.txt"), "x").unwrap();
        fs::create_dir_all(source.join("en")).unwrap();
        fs::write(source.join("en").join("c.en.md"), SAMPLE).unwrap();
        let copied = sync_from_dir(&root, source.to_str().unwrap()).unwrap();
        assert_eq!(copied, 3);
        assert_eq!(list(&root).unwrap().len(), 3);
        assert!(article_dir(&root).join("en").join("c.en.md").is_file());
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(windows)]
    #[test]
    fn translates_wsl_paths_to_windows_unc_paths() {
        assert_eq!(
            translate_source_dir("/home/alex/work/www.zicode.com"),
            "\\\\wsl.localhost\\Ubuntu\\home\\alex\\work\\www.zicode.com"
        );
        assert_eq!(translate_source_dir("/mnt/c/Users/alex"), "C:\\Users\\alex");
        assert_eq!(
            translate_source_dir("C:\\already\\windows"),
            "C:\\already\\windows"
        );
    }
}
