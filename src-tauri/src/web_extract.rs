//! 网页正文提取：类似 Readability 的打分 + 去噪，保留标题/图片/链接/列表/
//! 引用/代码/表格结构，输出可读 Markdown。采集笔记与 Pi 工具共用。

use ego_tree::NodeRef;
use encoding_rs::{Encoding, GB18030, UTF_16BE, UTF_16LE};
use scraper::{ElementRef, Html, Node, Selector};
use serde::Serialize;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebArticle {
    pub title: String,
    pub byline: Option<String>,
    pub site_name: Option<String>,
    pub image: Option<String>,
    pub content_markdown: String,
    pub text_length: usize,
}

/// 判定 IP 是否公网可达（禁止回环/私有/链路本地/保留段）。
pub fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            let [a, b, c, _] = address.octets();
            !(address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified()
                || address.is_multicast()
                || address.is_broadcast()
                || a == 0
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0 && c == 2)
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113)
                || (a == 198 && (18..=19).contains(&b)))
        }
        IpAddr::V6(address) => {
            let first = address.segments()[0];
            !(address.is_loopback()
                || address.is_unspecified()
                || address.is_multicast()
                || (first & 0xfe00) == 0xfc00
                || (first & 0xffc0) == 0xfe80)
        }
    }
}

fn validate_public_url(url: &reqwest::Url) -> Result<(), String> {
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only credential-free HTTP(S) URLs are allowed".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "URL host is missing".to_string())?;
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err("Loopback and private network URLs are not allowed".to_string());
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "URL port is invalid".to_string())?;
    let addresses: Vec<SocketAddr> = if let Ok(address) = host.parse::<IpAddr>() {
        vec![SocketAddr::new(address, port)]
    } else {
        (host, port)
            .to_socket_addrs()
            .map_err(|_| "Cannot resolve the web page host".to_string())?
            .collect()
    };
    if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err("Loopback and private network URLs are not allowed".to_string());
    }
    Ok(())
}

fn parse_charset_from_content_type(content_type: &str) -> Option<String> {
    let marker = "charset=";
    let idx = content_type.to_ascii_lowercase().find(marker)?;
    let rest = &content_type[idx + marker.len()..];
    rest.split([';', ' ', '"', '\''])
        .find(|part| !part.is_empty())
        .map(str::to_string)
}

/// Best-effort charset sniff from the first `<meta charset=...>` /
/// `<meta http-equiv="Content-Type" content="...charset=...">` tag.
fn detect_meta_charset(prefix: &str) -> Option<String> {
    let lower = prefix.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(start) = rest.find("<meta") {
        rest = &rest[start + "<meta".len()..];
        let end = rest.find('>').unwrap_or(rest.len());
        let tag = &rest[..end];
        rest = &rest[end..];
        if let Some(charset) = tag.split("charset=").nth(1).and_then(|value| {
            value
                .split(['"', '\'', ' ', '/', '>'])
                .find(|part| !part.is_empty())
        }) {
            return Some(charset.to_string());
        }
    }
    None
}

/// Decode a captured page body using the charset declared by a BOM, the HTTP
/// `Content-Type` header, an HTML `<meta>` tag, or a conservative fallback for
/// legacy GBK/GB2312 pages. Returns lossy UTF-8 so callers never hit a hard
/// "not UTF-8" failure for a valid non-UTF-8 page.
pub fn decode_html_bytes(bytes: &[u8], content_type: &str) -> String {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&bytes[3..]).into_owned();
    }
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let (text, _, _) = UTF_16LE.decode(&bytes[2..]);
        return text.into_owned();
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let (text, _, _) = UTF_16BE.decode(&bytes[2..]);
        return text.into_owned();
    }
    if let Some(label) = parse_charset_from_content_type(content_type) {
        if let Some(encoding) = Encoding::for_label(label.as_bytes()) {
            let (text, _, _) = encoding.decode(bytes);
            return text.into_owned();
        }
    }
    let prefix_len = bytes.len().min(2048);
    let prefix = String::from_utf8_lossy(&bytes[..prefix_len]);
    if let Some(label) = detect_meta_charset(&prefix) {
        if let Some(encoding) = Encoding::for_label(label.as_bytes()) {
            let (text, _, _) = encoding.decode(bytes);
            return text.into_owned();
        }
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    // A page that is almost entirely valid UTF-8 (a few corrupt bytes) should
    // keep its UTF-8 content with replacement characters, not be reinterpreted
    // wholesale as GB18030, which would garble every valid UTF-8 sequence.
    let lossy = String::from_utf8_lossy(bytes);
    if lossy
        .chars()
        .filter(|character| *character == '\u{FFFD}')
        .count()
        <= 8
    {
        return lossy.into_owned();
    }
    let (text, _, _) = GB18030.decode(bytes);
    text.into_owned()
}

/// 阻塞式抓取 + 正文提取，供 Pi 工具与无需异步运行时的调用方使用。
pub fn fetch_and_extract(raw_url: &str) -> Result<WebArticle, String> {
    const MAX_BYTES: usize = 2 * 1024 * 1024;
    const MAX_REDIRECTS: usize = 5;
    let mut url =
        reqwest::Url::parse(raw_url).map_err(|_| "Enter a valid HTTP(S) URL".to_string())?;
    let client = reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .user_agent("ZiCode-Notes-Capture/1.0")
        .build()
        .map_err(|_| "Cannot initialize web capture".to_string())?;
    for redirect_count in 0..=MAX_REDIRECTS {
        validate_public_url(&url)?;
        let response = client
            .get(url.clone())
            .header(
                reqwest::header::ACCEPT,
                "text/html, text/plain;q=0.8, application/xhtml+xml;q=0.7",
            )
            .send()
            .map_err(|_| "Cannot retrieve the web page".to_string())?;
        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err("The web page redirected too many times".to_string());
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or_else(|| "The web page returned an invalid redirect".to_string())?;
            url = url
                .join(location)
                .map_err(|_| "Redirect URL is invalid".to_string())?;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!(
                "The web page returned HTTP {}",
                response.status().as_u16()
            ));
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_plain = content_type.starts_with("text/plain");
        if !content_type.is_empty()
            && !content_type.starts_with("text/html")
            && !is_plain
            && !content_type.starts_with("application/xhtml+xml")
        {
            return Err("Only HTML and plain-text pages can be captured".to_string());
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_BYTES as u64)
        {
            return Err("The web page exceeds the 2 MiB capture limit".to_string());
        }
        let bytes = response
            .bytes()
            .map_err(|_| "Web page download failed".to_string())?;
        if bytes.len() > MAX_BYTES {
            return Err("The web page exceeds the 2 MiB capture limit".to_string());
        }
        let text = decode_html_bytes(&bytes, &content_type);
        let article = if is_plain {
            WebArticle {
                title: url
                    .path_segments()
                    .and_then(|segments| segments.filter(|value| !value.is_empty()).next_back())
                    .unwrap_or("Captured page")
                    .to_string(),
                byline: None,
                site_name: None,
                image: None,
                content_markdown: text.trim().to_string(),
                text_length: text_len(&text),
            }
        } else {
            extract(&text, url.as_ref())
        };
        if article.content_markdown.trim().is_empty() {
            return Err("No readable page content was found".to_string());
        }
        return Ok(article);
    }
    Err("The web page could not be captured".to_string())
}

const NOISE_TAGS: &[&str] = &[
    "script", "style", "noscript", "iframe", "svg", "canvas", "form", "button", "input",
    "textarea", "select", "dialog",
];

const NOISE_HINTS: &[&str] = &[
    "advert",
    "ad-",
    "-ad",
    "banner",
    "cookie",
    "share",
    "social",
    "related",
    "recommend",
    "comment",
    "sidebar",
    "menu",
    "pagination",
    "breadcrumb",
    "newsletter",
    "subscribe",
    "widget",
    "footer",
    "nav",
    "promo",
    "sponsor",
    "tracking",
    "modal",
    "popup",
    "aside",
    // Common pinyin class names on Chinese pages.
    "guanggao",
    "daohang",
    "pinglun",
    "xiangguan",
    "tuijian",
    "cebianlan",
    "yejiao",
    "yemei",
    "fenxiang",
    "dingyue",
];

const POSITIVE_HINTS: &[&str] = &[
    "article", "post", "content", "main", "entry", "story", "body", "news", "text",
    // Common pinyin class names for the main body on Chinese pages.
    "zhengwen", "neirong", "wenzhang",
];

fn is_noise(el: &ElementRef) -> bool {
    let tag = el.value().name().to_ascii_lowercase();
    if NOISE_TAGS.contains(&tag.as_str()) {
        return true;
    }
    let class = el.attr("class").unwrap_or("").to_ascii_lowercase();
    let id = el.attr("id").unwrap_or("").to_ascii_lowercase();
    let haystack = format!("{class} {id}");
    NOISE_HINTS.iter().any(|hint| haystack.contains(hint))
}

fn meta_content(document: &Html, names: &[&str]) -> Option<String> {
    let selector = Selector::parse("meta").ok()?;
    for element in document.select(&selector) {
        let key = element
            .attr("name")
            .or_else(|| element.attr("property"))
            .unwrap_or("")
            .to_ascii_lowercase();
        if names.iter().any(|name| key.eq_ignore_ascii_case(name)) {
            if let Some(content) = element.attr("content") {
                let content = content.trim();
                if !content.is_empty() {
                    return Some(content.to_string());
                }
            }
        }
    }
    None
}

fn resolve_url(base: &str, href: &str) -> Option<String> {
    let absolute = reqwest::Url::parse(base).ok()?.join(href).ok()?;
    if !matches!(absolute.scheme(), "http" | "https") {
        return None;
    }
    Some(absolute.to_string())
}

fn text_len(text: &str) -> usize {
    text.chars().filter(|c| !c.is_whitespace()).count()
}

fn element_score(el: &ElementRef) -> f64 {
    let text = el.text().collect::<String>();
    let len = text_len(&text) as f64;
    let class = el.attr("class").unwrap_or("").to_ascii_lowercase();
    let id = el.attr("id").unwrap_or("").to_ascii_lowercase();
    let haystack = format!("{class} {id}");
    let mut score = len / 25.0;
    score += text.matches(',').count() as f64;
    for hint in POSITIVE_HINTS {
        if haystack.contains(hint) {
            score += 25.0;
        }
    }
    for hint in NOISE_HINTS {
        if haystack.contains(hint) {
            score -= 25.0;
        }
    }
    // 链接密度惩罚：链接占比越高越像导航/相关推荐。
    let link_selector = Selector::parse("a").unwrap();
    let link_len: usize = el
        .select(&link_selector)
        .map(|a| text_len(&a.text().collect::<String>()))
        .sum();
    // A short element that is mostly a single link (e.g. a "Learn more"
    // paragraph) is content, not navigation. Only penalize link density on
    // blocks with enough text to be meaningful.
    if len > 60.0 {
        let density = link_len as f64 / len;
        if density > 0.5 {
            score -= 40.0 * density;
        }
    }
    score
}

fn walk_score<'a>(
    node: NodeRef<'a, scraper::Node>,
    best: &mut (f64, usize, Option<NodeRef<'a, scraper::Node>>),
) -> f64 {
    let element = match node.value() {
        Node::Element(element) => element,
        _ => return 0.0,
    };
    let tag = element.name().to_ascii_lowercase();
    if NOISE_TAGS.contains(&tag.as_str()) {
        return 0.0;
    }
    let is_leaf = matches!(
        tag.as_str(),
        "p" | "pre" | "li" | "blockquote" | "td" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
    );
    if is_leaf {
        return element_score(&ElementRef::wrap(node).expect("element"));
    }
    let mut total = 0.0;
    for child in node.children() {
        total += walk_score(child, best);
    }
    if tag != "body" && tag != "html" {
        let text = ElementRef::wrap(node)
            .map(|element| element.text().collect::<String>())
            .unwrap_or_default();
        let len = text_len(&text);
        // 更高分优先；同分取更“窄”（文本更少）的容器，避免选到 body。
        if total > best.0 || (total == best.0 && len > 0 && len < best.1) {
            *best = (total, len, Some(node));
        }
    }
    total
}

fn inline_markdown(node: NodeRef<scraper::Node>, base: &str, out: &mut String) {
    for child in node.children() {
        match child.value() {
            Node::Text(text) => out.push_str(&text.text),
            Node::Element(_) => {
                let el = ElementRef::wrap(child).expect("element");
                if is_noise(&el) {
                    continue;
                }
                let tag = el.value().name().to_ascii_lowercase();
                match tag.as_str() {
                    "strong" | "b" => {
                        out.push_str("**");
                        inline_markdown(child, base, out);
                        out.push_str("**");
                    }
                    "em" | "i" => {
                        out.push('*');
                        inline_markdown(child, base, out);
                        out.push('*');
                    }
                    "code" => {
                        out.push('`');
                        inline_markdown(child, base, out);
                        out.push('`');
                    }
                    "a" => {
                        let text = el.text().collect::<String>().trim().to_string();
                        let href = el.attr("href").unwrap_or("");
                        if !text.is_empty() {
                            let resolved =
                                resolve_url(base, href).unwrap_or_else(|| href.to_string());
                            out.push_str(&format!("[{text}]({resolved})"));
                        }
                    }
                    "img" => {
                        if let Some(src) = el.attr("src").and_then(|s| resolve_url(base, s)) {
                            let alt = el.attr("alt").unwrap_or("");
                            out.push_str(&format!("![{alt}]({src})"));
                        }
                    }
                    "br" => out.push('\n'),
                    _ => inline_markdown(child, base, out),
                }
            }
            _ => {}
        }
    }
}

fn block_markdown(node: NodeRef<scraper::Node>, base: &str, out: &mut String) {
    for child in node.children() {
        match child.value() {
            Node::Text(text) => {
                let value = text.text.trim();
                if !value.is_empty() {
                    out.push_str(value);
                    out.push_str("\n\n");
                }
            }
            Node::Element(_) => {
                let el = ElementRef::wrap(child).expect("element");
                if is_noise(&el) {
                    continue;
                }
                let tag = el.value().name().to_ascii_lowercase();
                match tag.as_str() {
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                        let level = tag.as_bytes()[1] - b'0';
                        let text = el.text().collect::<String>().trim().to_string();
                        if !text.is_empty() {
                            out.push_str(&format!("\n\n{} {text}\n\n", "#".repeat(level as usize)));
                        }
                    }
                    "p" => {
                        let mut content = String::new();
                        inline_markdown(child, base, &mut content);
                        let content = content.trim();
                        if !content.is_empty() {
                            out.push_str(content);
                            out.push_str("\n\n");
                        }
                    }
                    "blockquote" => {
                        let mut content = String::new();
                        block_markdown(child, base, &mut content);
                        let quoted = content
                            .trim()
                            .lines()
                            .map(|line| format!("> {line}"))
                            .collect::<Vec<_>>()
                            .join("\n");
                        out.push_str(&format!("\n\n{quoted}\n\n"));
                    }
                    "pre" => {
                        let code = el.text().collect::<String>();
                        out.push_str(&format!("\n\n```\n{code}\n```\n\n"));
                    }
                    "ul" | "ol" => {
                        let ordered = tag == "ol";
                        let mut index = 1;
                        for li in child.children() {
                            if !matches!(li.value(), Node::Element(e) if e.name() == "li") {
                                continue;
                            }
                            let mut content = String::new();
                            inline_markdown(li, base, &mut content);
                            let content = content.trim();
                            if content.is_empty() {
                                continue;
                            }
                            let marker = if ordered {
                                format!("{index}. ")
                            } else {
                                "- ".to_string()
                            };
                            out.push_str(&format!("{marker}{content}\n"));
                            if ordered {
                                index += 1;
                            }
                        }
                        out.push('\n');
                    }
                    "table" => {
                        render_table(&el, out);
                    }
                    _ => block_markdown(child, base, out),
                }
            }
            _ => {}
        }
    }
}

fn render_table(table: &ElementRef, out: &mut String) {
    let mut rows: Vec<Vec<String>> = Vec::new();
    for tr in table.select(&Selector::parse("tr").unwrap()) {
        let cells = tr
            .select(&Selector::parse("th,td").unwrap())
            .map(|cell| cell.text().collect::<String>().trim().replace('\n', " "))
            .collect::<Vec<_>>();
        if !cells.is_empty() {
            rows.push(cells);
        }
    }
    let Some(first) = rows.first() else {
        return;
    };
    let columns = rows
        .iter()
        .map(Vec::len)
        .max()
        .unwrap_or(first.len())
        .max(1);
    let mut header = Vec::new();
    for i in 0..columns {
        header.push(first.get(i).cloned().unwrap_or_default());
    }
    out.push('\n');
    out.push_str(&format!("| {} |\n", header.join(" | ")));
    out.push_str(&format!("| {} |\n", vec!["---"; columns].join(" | ")));
    for row in rows.iter().skip(1) {
        let mut cells = row.clone();
        cells.resize(columns, String::new());
        out.push_str(&format!("| {} |\n", cells.join(" | ")));
    }
    out.push('\n');
}

pub fn extract(html: &str, base_url: &str) -> WebArticle {
    let document = Html::parse_document(html);
    let title = meta_content(&document, &["og:title"])
        .or_else(|| {
            Selector::parse("title")
                .ok()
                .and_then(|selector| document.select(&selector).next())
                .map(|element| element.text().collect::<String>())
        })
        .or_else(|| {
            Selector::parse("h1")
                .ok()
                .and_then(|selector| document.select(&selector).next())
                .map(|element| element.text().collect::<String>())
        })
        .map(|value| value.trim().chars().take(200).collect::<String>())
        .unwrap_or_default();
    let byline = meta_content(&document, &["author", "article:author"]);
    let site_name = meta_content(&document, &["og:site_name"]);
    let image = meta_content(&document, &["og:image", "twitter:image"])
        .and_then(|value| resolve_url(base_url, &value));

    let root = document.root_element();
    let mut best: (f64, usize, Option<NodeRef<scraper::Node>>) = (0.0, usize::MAX, None);
    for child in root.children() {
        walk_score(child, &mut best);
    }
    let mut content_markdown = String::new();
    if let Some(candidate) = best.2 {
        block_markdown(candidate, base_url, &mut content_markdown);
    }
    let text_length = text_len(&content_markdown);

    WebArticle {
        title,
        byline,
        site_name,
        image,
        content_markdown,
        text_length,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<html><head><title>示例文章</title></head><body>
      <header><nav><a href="/">首页</a><a href="/about">关于</a></nav></header>
      <aside class="sidebar"><a href="/x">推荐阅读1</a><a href="/y">推荐阅读2</a></aside>
      <div class="ad-banner">点击购买！</div>
      <main><article>
        <h1>真正的正文标题</h1>
        <p>这是正文的第一段，包含足够多的文字用于评分与提取，介绍来龙去脉。</p>
        <p>第二段继续展开，补充细节与结论，文字量再大一些以便被识别为正文。</p>
        <h2>小节</h2>
        <ul><li>要点一</li><li>要点二</li></ul>
        <blockquote>一句引用。</blockquote>
        <pre><code>let x = 1;</code></pre>
      </article></main>
      <footer>版权信息，页脚内容。</footer>
    </body></html>"#;

    #[test]
    fn extracts_main_content_and_drops_noise() {
        let article = extract(SAMPLE, "https://example.com/a");
        assert_eq!(article.title, "示例文章");
        assert!(article.content_markdown.contains("真正的正文标题"));
        assert!(article.content_markdown.contains("第一段"));
        assert!(article.content_markdown.contains("要点一"));
        assert!(article.content_markdown.contains("一句引用"));
        assert!(article.content_markdown.contains("```\nlet x = 1;\n```"));
        assert!(!article.content_markdown.contains("首页"));
        assert!(!article.content_markdown.contains("推荐阅读"));
        assert!(!article.content_markdown.contains("点击购买"));
        assert!(!article.content_markdown.contains("版权信息"));
    }

    #[test]
    fn resolves_relative_links_and_images() {
        let html = r#"<html><body><article>
          <h1>标题</h1>
          <p>这是一段有实际正文内容的文字，用于说明链接与图片的解析，且链接密度很低，文字量充足。</p>
          <p>访问<a href="/about">关于页面</a>查看更多，<img src="/img.png" alt="插图">。</p>
        </article></body></html>"#;
        let article = extract(html, "https://example.com/base/page.html");
        assert!(article
            .content_markdown
            .contains("[关于页面](https://example.com/about)"));
        assert!(article
            .content_markdown
            .contains("![插图](https://example.com/img.png)"));
    }

    #[test]
    fn rejects_non_http_image_urls() {
        let html = r#"<html><body><article><img src="javascript:alert(1)" alt="x"></article></body></html>"#;
        let article = extract(html, "https://example.com/");
        assert!(!article.content_markdown.contains("javascript:"));
    }

    #[test]
    fn extracts_a_minimal_div_page() {
        let html = r#"<html lang="en"><head><title>Example Domain</title></head><body><div><h1>Example Domain</h1><p>This domain is for use in documentation examples without needing permission. Avoid use in operations.</p><p><a href="https://iana.org/domains/example">Learn more</a></p></div></body></html>"#;
        let article = extract(html, "https://example.com/");
        assert!(article.content_markdown.contains("documentation examples"));
    }

    #[test]
    fn recognizes_pinyin_class_names_for_chinese_pages() {
        let html = r#"<html><body>
          <div class="daohang"><a>首页</a><a>分类导航</a></div>
          <div class="zhengwen">
            <h1>拼音正文标题</h1>
            <p>这是正文内容，用于验证拼音 class 名能被正确识别为正文，并保留下来。</p>
          </div>
          <div class="guanggao">广告内容</div>
          <div class="pinglun">评论内容</div>
        </body></html>"#;
        let article = extract(html, "https://example.com/pinyin");
        assert!(article.content_markdown.contains("拼音正文标题"));
        assert!(article.content_markdown.contains("拼音 class 名"));
        assert!(!article.content_markdown.contains("广告内容"));
        assert!(!article.content_markdown.contains("评论内容"));
        assert!(!article.content_markdown.contains("首页"));
    }

    #[test]
    fn decodes_utf8_body_unchanged() {
        let text = "中文正文内容 Example";
        assert_eq!(decode_html_bytes(text.as_bytes(), ""), text);
    }

    #[test]
    fn decodes_gbk_body_from_content_type_charset() {
        let (gbk_bytes, _, _) = encoding_rs::GBK.encode("这是一段中文正文内容");
        let decoded = decode_html_bytes(&gbk_bytes, "text/html; charset=gbk");
        assert!(decoded.contains("这是一段中文正文内容"));
    }

    #[test]
    fn decodes_gbk_body_from_meta_charset() {
        let mut bytes = b"<html><head><meta charset=\"gbk\"></head><body>".to_vec();
        let (gbk_body, _, _) = encoding_rs::GBK.encode("中文正文内容");
        bytes.extend_from_slice(&gbk_body);
        let decoded = decode_html_bytes(&bytes, "");
        assert!(decoded.contains("中文正文内容"));
    }

    #[test]
    fn decodes_gbk_body_without_declared_charset() {
        let (gbk_bytes, _, _) = encoding_rs::GBK.encode("中文正文内容");
        let decoded = decode_html_bytes(&gbk_bytes, "");
        assert!(decoded.contains("中文正文内容"));
    }

    #[test]
    fn decodes_utf16le_bom_body() {
        let utf16_bytes: Vec<u8> = "中文正文内容"
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect();
        let mut bytes = vec![0xFF, 0xFE];
        bytes.extend_from_slice(&utf16_bytes);
        let decoded = decode_html_bytes(&bytes, "");
        assert!(decoded.contains("中文正文内容"));
    }

    #[test]
    fn preserves_mostly_utf8_when_a_few_bytes_are_corrupt() {
        let mut bytes = "中文正文内容".as_bytes().to_vec();
        bytes[1] = 0xFF; // corrupt the second byte of the first UTF-8 char
        let decoded = decode_html_bytes(&bytes, "");
        assert!(decoded.contains("文正文内容"));
        assert!(!decoded.contains("中文正文内容"));
    }
}
