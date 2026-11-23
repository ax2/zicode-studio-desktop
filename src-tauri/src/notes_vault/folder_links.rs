use super::*;
use percent_encoding::percent_decode_str;
use regex::{Captures, Regex};
use std::collections::BTreeMap;
use std::sync::LazyLock;

static LINKS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
    r#"(?P<escape>\\.)|(?P<code>[\x60]+[^\x60\n]*[\x60]+)|(?P<wiki>!?\[\[(?P<wiki_target>[^\[\]\n]+)\]\])|(?P<link>!?\[(?P<label>[^\[\]\n]*)\]\((?:<(?P<angle>[^<>\n]+)>|(?P<destination>[^()\s]+))\))"#,
).expect("Notes import link patterns")
});

pub(super) struct Targets<'a> {
    exact: BTreeMap<String, &'a str>,
    by_name: BTreeMap<String, Option<&'a str>>,
}

impl<'a> Targets<'a> {
    pub(super) fn new(paths: impl Iterator<Item = &'a str>) -> Self {
        let mut exact = BTreeMap::new();
        let mut by_name = BTreeMap::new();
        for path in paths {
            exact.insert(path.to_lowercase(), path);
            let base = path.rsplit('/').next().unwrap_or(path).to_lowercase();
            by_name
                .entry(base)
                .and_modify(|target| *target = None)
                .or_insert(Some(path));
        }
        Self { exact, by_name }
    }

    pub(super) fn lookup(&self, from: &str, target: &str, wiki: bool) -> Option<&'a str> {
        let parent = from.rsplit_once('/').map_or("", |(parent, _)| parent);
        let candidates = if wiki && Path::new(target).extension().is_none() {
            vec![
                target.to_owned(),
                format!("{target}.md"),
                format!("{target}.markdown"),
            ]
        } else {
            vec![target.to_owned()]
        };
        for candidate in &candidates {
            if let Some(path) = relative_path(parent, candidate)
                .and_then(|path| self.exact.get(&path.to_lowercase()))
            {
                return Some(path);
            }
        }
        if wiki {
            for candidate in &candidates {
                if let Some(path) = relative_path("", candidate)
                    .and_then(|path| self.exact.get(&path.to_lowercase()))
                {
                    return Some(path);
                }
                if !candidate.contains('/') {
                    if let Some(Some(path)) = self.by_name.get(&candidate.to_lowercase()) {
                        return Some(path);
                    }
                }
            }
        }
        None
    }
}

fn relative_path(parent: &str, target: &str) -> Option<String> {
    if target.is_empty() || target.contains(['\\', ':', '\0']) || target.starts_with("//") {
        return None;
    }
    let mut parts: Vec<&str> = if target.starts_with('/') || parent.is_empty() {
        Vec::new()
    } else {
        parent.split('/').collect()
    };
    for part in target.trim_start_matches('/').split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(part),
        }
    }
    Some(parts.join("/"))
}

pub(super) struct Link<'a> {
    pub target: String,
    pub anchor: Option<String>,
    pub label: &'a str,
    pub wiki: bool,
    pub image: bool,
}

pub(super) fn rewrite(input: &str, mut resolve: impl FnMut(Link<'_>) -> Option<String>) -> String {
    let mut output = String::with_capacity(input.len());
    let mut fence: Option<(u8, usize)> = None;
    for line in input.split_inclusive('\n') {
        let trimmed = line.trim_start_matches(' ');
        let indent = line.len() - trimmed.len();
        let delimiter = trimmed
            .as_bytes()
            .first()
            .copied()
            .filter(|char| indent <= 3 && matches!(char, b'\x60' | b'~'));
        if let Some(delimiter) = delimiter {
            let run = trimmed
                .bytes()
                .take_while(|byte| *byte == delimiter)
                .count();
            if run >= 3 {
                if let Some((expected, minimum)) = fence {
                    if delimiter == expected && run >= minimum && trimmed[run..].trim().is_empty() {
                        fence = None;
                    }
                } else {
                    fence = Some((delimiter, run));
                }
                output.push_str(line);
                continue;
            }
        }
        if fence.is_some() || indent >= 4 || line.starts_with('\t') {
            output.push_str(line);
        } else {
            output.push_str(&LINKS.replace_all(line, |captures: &Captures<'_>| {
                let original = captures.get(0).expect("complete Markdown match").as_str();
                let wiki = captures.name("wiki").is_some();
                let (raw_target, label) = if let Some(target) = captures.name("wiki_target") {
                    let value = target.as_str();
                    value.split_once('|').unwrap_or((value, value))
                } else if let Some(target) = captures
                    .name("angle")
                    .or_else(|| captures.name("destination"))
                {
                    (
                        target.as_str(),
                        captures.name("label").expect("Markdown label").as_str(),
                    )
                } else {
                    return original.to_owned();
                };
                let raw_target = raw_target.trim();
                if raw_target.starts_with('#')
                    || raw_target.starts_with("//")
                    || raw_target.contains(':')
                {
                    return original.to_owned();
                }
                let (path, section) = raw_target
                    .split_once('#')
                    .map_or((raw_target, None), |(path, section)| {
                        (path, Some(section.to_owned()))
                    });
                let decoded = percent_decode_str(path).decode_utf8_lossy().into_owned();
                resolve(Link {
                    target: decoded,
                    anchor: section,
                    label,
                    wiki,
                    image: original.starts_with('!'),
                })
                .unwrap_or_else(|| original.to_owned())
            }));
        }
    }
    output
}
