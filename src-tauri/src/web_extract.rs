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
                    .and_then(|mut segments| segments.rfind(|value| !value.is_empty()))
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
    "textarea", "select", "dialog", "nav", "footer", "aside",
];

const NOISE_HINTS: &[&str] = &[
    "advert",
    "ad-",
    "-ad",
    "adsbygoogle",
    "adsense",
    "doubleclick",
    "google-ads",
    "ad-slot",
    "adslot",
    "dfp",
    "banner",
    "masthead",
    "topbar",
    "navbar",
    "subnav",
    "cookie",
    "cookie-consent",
    "cookiewall",
    "consent",
    "share",
    "social",
    "related",
    "related-posts",
    "recommendations",
    "recommend",
    "comment",
    "sidebar",
    "menu",
    "breadcrumbs",
    "crumb",
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
    "overlay",
    "lightbox",
    "toolbar",
    "aside",
    "search",
    "tag-cloud",
    "tags-cloud",
    "taglist",
    "archive",
    "category",
    "author-box",
    "author-bio",
    "profile-card",
    "user-info",
    "login",
    "register",
    "signup",
    "download",
    "app-download",
    "qrcode",
    "weixin",
    "wechat",
    "gongzhonghao",
    "follow",
    "feedback",
    "survey",
    "poll",
    "ranking",
    "hotlist",
    "trending",
    "toplist",
    "skip-link",
    "visually-hidden",
    "sr-only",
    "screen-reader",
    "noindex",
    "sticky",
    "toast",
    "snackbar",
    "site-header",
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
    "tiepian",
    "dibu",
    "redu",
    "paixing",
    "remen",
    "sousuo",
    "denglu",
    "zhuce",
    "xiaza",
    "guanzhu",
    "banquan",
    "mianze",
];

const POSITIVE_HINTS: &[&str] = &[
    "article", "post", "content", "main", "entry", "story", "body", "news", "text",
    // Common pinyin class names for the main body on Chinese pages.
    "zhengwen", "neirong", "wenzhang",
];

/// 边界感知的噪声提示匹配：只接受出现在词首/词尾或与分隔符相邻的命中，
/// 避免把 `research` 当成 `search`、把 `loader` 当成 `ad` 这类误伤。
fn hint_matches(haystack: &str, hint: &str) -> bool {
    if hint.is_empty() || haystack.is_empty() {
        return false;
    }
    let bytes = haystack.as_bytes();
    let needle = hint.as_bytes();
    // `ad-`/`-ad` 这类前后缀提示只要求在词首/词尾；普通单词提示要求命中
    // 必须位于一个词的开始（允许词尾继续扩展，如 advertisement ⊃ advert），
    // 从而避免 research ⊃ search、loader ⊃ ad 这类误伤。
    let requires_after_boundary = hint.starts_with('-');
    let mut from = 0;
    while let Some(relative) = haystack[from..].find(hint) {
        let absolute = from + relative;
        let before_ok = absolute == 0 || !bytes[absolute - 1].is_ascii_alphanumeric();
        let after = absolute + needle.len();
        let after_ok = after >= bytes.len() || !bytes[after].is_ascii_alphanumeric();
        let matched = if requires_after_boundary {
            after_ok
        } else {
            before_ok
        };
        if matched {
            return true;
        }
        from = absolute + 1;
    }
    false
}

fn is_noise(el: &ElementRef) -> bool {
    let tag = el.value().name().to_ascii_lowercase();
    // body/html 的 class 常包含皮肤/站点级标记（如
    // skin-vector-search-vue），不能因提示词把整页判为噪声。
    if tag == "body" || tag == "html" {
        return false;
    }
    if NOISE_TAGS.contains(&tag.as_str()) {
        return true;
    }
    if el
        .attr("aria-hidden")
        .is_some_and(|value| value.eq_ignore_ascii_case("true"))
        || el.attr("hidden").is_some()
        || el.attr("data-nosnippet").is_some()
    {
        return true;
    }
    let role = el.attr("role").unwrap_or("").to_ascii_lowercase();
    if matches!(
        role.as_str(),
        "banner" | "navigation" | "complementary" | "contentinfo" | "search" | "dialog" | "alert"
    ) {
        return true;
    }
    let class = el.attr("class").unwrap_or("").to_ascii_lowercase();
    let id = el.attr("id").unwrap_or("").to_ascii_lowercase();
    let haystack = format!("{class} {id}");
    NOISE_HINTS.iter().any(|hint| hint_matches(&haystack, hint))
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

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&#160;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
}

fn escape_link_label(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
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
    match el.value().name().to_ascii_lowercase().as_str() {
        "article" => score += 15.0,
        "main" => score += 10.0,
        _ => {}
    }
    for hint in POSITIVE_HINTS {
        if haystack.contains(hint) {
            score += 25.0;
        }
    }
    for hint in NOISE_HINTS {
        if hint_matches(&haystack, hint) {
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
    let wrapped = ElementRef::wrap(node).expect("element");
    if is_noise(&wrapped) {
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
        let text = wrapped.text().collect::<String>();
        let len = text_len(&text);
        // 容器加分：article/main 语义与段落、标题数量，帮助正文容器胜过
        // 同样文本量的导航/推荐列表。
        let mut container_bonus = 0.0;
        match tag.as_str() {
            "article" => container_bonus += 15.0,
            "main" => container_bonus += 10.0,
            _ => {}
        }
        let paragraph_count = wrapped.select(&Selector::parse("p").unwrap()).count();
        let heading_count = wrapped
            .select(&Selector::parse("h1,h2,h3,h4,h5,h6").unwrap())
            .count();
        container_bonus += paragraph_count as f64 * 2.0 + heading_count as f64 * 2.0;
        let candidate = total + container_bonus;
        // 更高分优先；同分取更“窄”（文本更少）的容器，避免选到 body。
        if candidate > best.0 || (candidate == best.0 && len > 0 && len < best.1) {
            *best = (candidate, len, Some(node));
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
                    "em" | "i" | "cite" => {
                        out.push('*');
                        inline_markdown(child, base, out);
                        out.push('*');
                    }
                    "code" | "kbd" | "samp" | "var" => {
                        out.push('`');
                        inline_markdown(child, base, out);
                        out.push('`');
                    }
                    "del" | "s" | "strike" => {
                        out.push_str("~~");
                        inline_markdown(child, base, out);
                        out.push_str("~~");
                    }
                    "q" => {
                        out.push('“');
                        inline_markdown(child, base, out);
                        out.push('”');
                    }
                    "a" => {
                        let href = el.attr("href").unwrap_or("");
                        let resolved = resolve_url(base, href).unwrap_or_else(|| href.to_string());
                        let linked_image = el
                            .select(&Selector::parse("img").unwrap())
                            .next()
                            .and_then(|image| {
                                image
                                    .attr("src")
                                    .and_then(|src| resolve_url(base, src))
                                    .map(|src| {
                                        let alt = image.attr("alt").unwrap_or("");
                                        format!("![{alt}]({src})")
                                    })
                            });
                        if let Some(label) = linked_image {
                            out.push_str(&format!("[{label}]({resolved})"));
                            continue;
                        }
                        let text = el.text().collect::<String>().trim().to_string();
                        if !text.is_empty() {
                            out.push_str(&format!("[{}]({resolved})", escape_link_label(&text)));
                        }
                    }
                    "img" => {
                        if let Some(src) = el.attr("src").and_then(|s| resolve_url(base, s)) {
                            let alt = el.attr("alt").unwrap_or("");
                            out.push_str(&format!("![{alt}]({src})"));
                        }
                    }
                    "br" => out.push('\n'),
                    "ul" | "ol" => {
                        // 嵌套列表由块级渲染器负责缩进，内联阶段跳过避免重复。
                    }
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
                        let mut text = String::new();
                        inline_markdown(child, base, &mut text);
                        let text = text.trim();
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
                    "ul" | "ol" => render_list(child, base, out, 0),
                    "table" => {
                        render_table(&el, base, out);
                    }
                    "img" => {
                        if let Some(src) = el.attr("src").and_then(|s| resolve_url(base, s)) {
                            let alt = el.attr("alt").unwrap_or("");
                            out.push_str(&format!("![{alt}]({src})\n\n"));
                        }
                    }
                    "figcaption" => {
                        let mut caption = String::new();
                        inline_markdown(child, base, &mut caption);
                        let caption = caption.trim();
                        if !caption.is_empty() {
                            out.push_str(&format!("*{caption}*\n\n"));
                        }
                    }
                    "figure" => {
                        let mut figure = String::new();
                        block_markdown(child, base, &mut figure);
                        let figure = figure.trim();
                        if !figure.is_empty() {
                            out.push_str(&format!("\n\n{figure}\n\n"));
                        }
                    }
                    "hr" => out.push_str("\n\n---\n\n"),
                    "summary" => {
                        let mut summary = String::new();
                        inline_markdown(child, base, &mut summary);
                        let summary = summary.trim();
                        if !summary.is_empty() {
                            out.push_str(&format!("**{summary}**\n\n"));
                        }
                    }
                    "dl" => {
                        for term_or_def in child.children() {
                            let Some(entry) = ElementRef::wrap(term_or_def) else {
                                continue;
                            };
                            match entry.value().name().to_ascii_lowercase().as_str() {
                                "dt" => {
                                    let mut term = String::new();
                                    inline_markdown(term_or_def, base, &mut term);
                                    let term = term.trim();
                                    if !term.is_empty() {
                                        out.push_str(&format!("**{term}**\n\n"));
                                    }
                                }
                                "dd" => {
                                    let mut definition = String::new();
                                    block_markdown(term_or_def, base, &mut definition);
                                    let definition = definition.trim();
                                    if !definition.is_empty() {
                                        out.push_str(&format!(": {definition}\n\n"));
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    "video" | "audio" => {
                        let source = el.attr("src").map(str::to_string).or_else(|| {
                            el.select(&Selector::parse("source").unwrap())
                                .next()
                                .and_then(|source| source.attr("src").map(str::to_string))
                        });
                        if let Some(source) = source.and_then(|src| resolve_url(base, &src)) {
                            let label = if tag == "video" { "video" } else { "audio" };
                            out.push_str(&format!("[{label}: {source}]({source})\n\n"));
                        }
                    }
                    _ => block_markdown(child, base, out),
                }
            }
            _ => {}
        }
    }
}

fn render_list(node: NodeRef<scraper::Node>, base: &str, out: &mut String, depth: usize) {
    let ordered = matches!(
        node.value(),
        Node::Element(element) if element.name().eq_ignore_ascii_case("ol")
    );
    let mut index = 1;
    let indent = "  ".repeat(depth);
    for child in node.children() {
        let Some(li) = ElementRef::wrap(child) else {
            continue;
        };
        if !li.value().name().eq_ignore_ascii_case("li") {
            continue;
        }
        let mut content = String::new();
        inline_markdown(child, base, &mut content);
        let content = content.trim();
        if !content.is_empty() {
            let marker = if ordered {
                format!("{index}. ")
            } else {
                "- ".to_string()
            };
            out.push_str(&format!("{indent}{marker}{content}\n"));
        }
        for nested in child.children() {
            if matches!(
                nested.value(),
                Node::Element(element)
                    if element.name().eq_ignore_ascii_case("ul")
                        || element.name().eq_ignore_ascii_case("ol")
            ) {
                render_list(nested, base, out, depth + 1);
            }
        }
        if ordered {
            index += 1;
        }
    }
    if depth == 0 {
        out.push('\n');
    }
}

fn render_table(table: &ElementRef, base: &str, out: &mut String) {
    let mut rows: Vec<Vec<String>> = Vec::new();
    for tr in table.select(&Selector::parse("tr").unwrap()) {
        let mut cells = Vec::new();
        for cell in tr.select(&Selector::parse("th,td").unwrap()) {
            let mut content = String::new();
            inline_markdown(*cell, base, &mut content);
            cells.push(
                content
                    .trim()
                    .replace(['\n', '\r'], " ")
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" "),
            );
        }
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

/// 折叠多余空行、去掉行尾空白，让 Markdown 输出更紧凑可读。
fn normalize_markdown(markdown: String) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut blank = 0usize;
    for line in markdown.lines() {
        let trimmed = line.trim_end();
        if trimmed.trim().is_empty() {
            blank += 1;
            if blank <= 1 {
                lines.push(String::new());
            }
            continue;
        }
        blank = 0;
        lines.push(trimmed.to_string());
    }
    while lines.last().is_some_and(|line| line.trim().is_empty()) {
        lines.pop();
    }
    lines.join("\n")
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
        .map(|value| {
            decode_html_entities(value.trim())
                .chars()
                .take(200)
                .collect::<String>()
        })
        .unwrap_or_default();
    let byline = meta_content(&document, &["author", "article:author"])
        .map(|value| decode_html_entities(&value));
    let site_name =
        meta_content(&document, &["og:site_name"]).map(|value| decode_html_entities(&value));
    let image = meta_content(&document, &["og:image", "twitter:image"])
        .map(|value| decode_html_entities(&value))
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
    let content_markdown = normalize_markdown(content_markdown);
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

    #[test]
    fn decodes_html_entities_in_meta_title_and_site_name() {
        let html = r#"<html><head>
          <meta property="og:title" content="Rock &amp; Roll &amp; More">
          <meta property="og:site_name" content="A &amp; B">
          <title>Fallback Title</title>
        </head><body><article>
          <h1>Heading</h1>
          <p>Some readable content text goes here for scoring.</p>
        </article></body></html>"#;
        let article = extract(html, "https://example.com/");
        assert_eq!(article.title, "Rock & Roll & More");
        assert_eq!(article.site_name.as_deref(), Some("A & B"));
    }

    #[test]
    fn removes_semantic_noise_regions_without_class_hints() {
        let html = r#"<html><head><title>Semantic</title></head><body>
          <header role="banner"><p>站点名</p></header>
          <nav><ul><li><a>首页</a></li><li><a>分类</a></li></ul></nav>
          <main>
            <article>
              <h1>正文标题</h1>
              <p>这里是正文的第一段，包含足够多的文字用于评分，介绍背景与上下文。</p>
              <p>第二段补充更多细节，继续展开论述，让内容更完整。</p>
            </article>
          </main>
          <footer><p>版权所有</p></footer>
          <aside><p>相关推荐</p></aside>
          <div aria-hidden="true"><p>隐藏内容</p></div>
        </body></html>"#;
        let article = extract(html, "https://example.com/");
        assert!(article.content_markdown.contains("正文标题"));
        assert!(article.content_markdown.contains("第一段"));
        assert!(!article.content_markdown.contains("站点名"));
        assert!(!article.content_markdown.contains("首页"));
        assert!(!article.content_markdown.contains("分类"));
        assert!(!article.content_markdown.contains("版权所有"));
        assert!(!article.content_markdown.contains("相关推荐"));
        assert!(!article.content_markdown.contains("隐藏内容"));
    }

    #[test]
    fn renders_nested_lists_with_indentation() {
        let html = r#"<html><body><article>
          <h1>列表标题</h1>
          <p>列表前的正文，文字量足够，用于说明下面的结构。</p>
          <ul>
            <li>第一层项目一</li>
            <li>第一层项目二
              <ul>
                <li>第二层项目一</li>
                <li>第二层项目二</li>
              </ul>
            </li>
            <li>第一层项目三</li>
          </ul>
        </article></body></html>"#;
        let article = extract(html, "https://example.com/");
        assert!(article
            .content_markdown
            .contains("- 第一层项目二\n  - 第二层项目一\n  - 第二层项目二\n- 第一层项目三"));
    }

    #[test]
    fn preserves_figure_styles_and_definition_lists() {
        let html = r#"<html><body><article>
          <h1>样式标题</h1>
          <p>正文包含<del>删除内容</del>与<q>引用片段</q>，以及<kbd>Ctrl</kbd>键。</p>
          <figure>
            <img src="/photo.png" alt="示意图">
            <figcaption>图 1：示例</figcaption>
          </figure>
          <dl>
            <dt>术语</dt>
            <dd>定义内容</dd>
          </dl>
          <hr>
          <p>结尾段落，补充说明。</p>
        </article></body></html>"#;
        let article = extract(html, "https://example.com/");
        let markdown = &article.content_markdown;
        assert!(markdown.contains("~~删除内容~~"));
        assert!(markdown.contains("“引用片段”"));
        assert!(markdown.contains("`Ctrl`"));
        assert!(markdown.contains("![示意图](https://example.com/photo.png)"));
        assert!(markdown.contains("*图 1：示例*"));
        assert!(markdown.contains("**术语**"));
        assert!(markdown.contains(": 定义内容"));
        assert!(markdown.contains("---"));
    }

    #[test]
    fn renders_inline_markdown_inside_headings_and_table_cells() {
        let html = r#"<html><body><article>
          <h1>标题</h1>
          <p>表格前的说明文字，确保有足够正文用于选择容器。</p>
          <h2>查看<a href="/docs">文档</a></h2>
          <table>
            <tr><th>名称</th><th>链接</th></tr>
            <tr><td>示例</td><td><a href="/x">打开</a></td></tr>
          </table>
        </article></body></html>"#;
        let article = extract(html, "https://example.com/base/page.html");
        assert!(article
            .content_markdown
            .contains("## 查看[文档](https://example.com/docs)"));
        assert!(article
            .content_markdown
            .contains("| [打开](https://example.com/x) |"));
    }

    #[test]
    fn prefers_article_container_over_navigation_lists() {
        let html = r#"<html><body>
          <div class="nav-list">
            <a>导航一</a><a>导航二</a><a>导航三</a><a>导航四</a><a>导航五</a><a>导航六</a>
          </div>
          <div>
            <h1>文章标题</h1>
            <p>正文第一段，包含丰富的内容描述，用来介绍主题背景和写作动机。</p>
            <p>正文第二段，进一步说明细节，并给出结论和后续展望。</p>
          </div>
        </body></html>"#;
        let article = extract(html, "https://example.com/");
        assert!(article.content_markdown.contains("文章标题"));
        assert!(article.content_markdown.contains("正文第一段"));
        assert!(!article.content_markdown.contains("导航一"));
    }

    #[test]
    fn removes_cookie_consent_banner() {
        let html = r#"<html><body>
          <div id="cookie-consent" role="dialog"><p>接受 Cookie</p></div>
          <main><article>
            <h1>标题</h1>
            <p>正文第一段，内容足够用于评分，说明页面主题。</p>
          </article></main>
        </body></html>"#;
        let article = extract(html, "https://example.com/");
        assert!(article.content_markdown.contains("标题"));
        assert!(!article.content_markdown.contains("接受 Cookie"));
    }

    #[test]
    fn does_not_treat_research_as_search_noise() {
        let html = r#"<html><body><article>
          <h1>研究方法</h1>
          <p>本小节介绍研究内容，包含足够的文字用于正文评分，并且没有广告噪声。</p>
          <div class="research-note">
            <p>研究笔记段落，展示边界匹配不会把 research 误判为 search。</p>
          </div>
        </article></body></html>"#;
        let article = extract(html, "https://example.com/");
        assert!(article.content_markdown.contains("研究笔记段落"));
    }

    #[test]
    #[ignore = "network smoke: fetch a real article and report extraction quality"]
    fn real_page_extraction_smoke() {
        let url = std::env::var("ZICODE_SMOKE_URL")
            .unwrap_or_else(|_| "https://en.wikipedia.org/wiki/Web_scraping".to_string());
        let article = fetch_and_extract(&url).unwrap();
        eprintln!("TITLE: {}", article.title);
        eprintln!("TEXT_LENGTH: {}", article.text_length);
        eprintln!(
            "MARKDOWN_HEAD: {}",
            article
                .content_markdown
                .chars()
                .take(1200)
                .collect::<String>()
        );
        let lower = article.content_markdown.to_ascii_lowercase();
        if url.contains("wikipedia.org") {
            for noise in ["main page", "random article", "donate", "about wikipedia"] {
                assert!(!lower.contains(noise), "noise leaked: {noise}");
            }
            assert!(lower.contains("web scraping"));
        }
    }
}
