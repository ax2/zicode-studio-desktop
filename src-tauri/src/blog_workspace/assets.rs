use super::{catalog, site};
use regex::Regex;
use serde::Serialize;
use std::io::{BufReader, Read};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::LazyLock,
};

pub(super) const PREFIX: &str = "@asset/";
const GITHUB_MAX_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Default, Serialize)]
pub(super) struct Preview {
    pub paths: BTreeSet<String>,
    pub deletions: BTreeSet<String>,
    pub sizes: BTreeMap<String, u64>,
}

#[derive(Default)]
pub(super) struct ArticleImages {
    slugs: BTreeSet<String>,
    pub references: BTreeSet<String>,
}

fn allowed(path: &str) -> bool {
    let Some(name) = path.strip_prefix("public/") else {
        return false;
    };
    let first = name.split('/').next().unwrap_or("");
    if !matches!(first, "heroes" | "images" | "uploads" | "blog")
        || name
            .split('/')
            .any(|part| matches!(part, "thumbs" | "featured"))
    {
        return false;
    }
    let extension = Path::new(path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "svg" | "gif" | "webp" | "avif"
    )
}

impl ArticleImages {
    fn add_url(&mut self, url: &str) -> Result<(), String> {
        let Some(local) = url.trim().strip_prefix('/') else {
            return Ok(());
        };
        if local.starts_with('/') {
            return Ok(());
        }
        let local = local.split(['?', '#']).next().unwrap_or("");
        let local = percent_encoding::percent_decode_str(local)
            .decode_utf8()
            .map_err(|_| "blog_invalid_path")?;
        let file = format!("public/{local}");
        if allowed(&file) {
            self.references.insert(file);
        }
        Ok(())
    }

    pub fn include(&mut self, root: &Path, key: &str) -> Result<(), String> {
        let content = site::read(&site::resolve(root, key, false)?)?;
        let filename = Path::new(key)
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("blog_invalid_path")?;
        self.slugs.insert(filename.to_owned());
        if let Some(fields) = catalog::metadata(content.as_bytes()) {
            for field in ["slug", "urlSlug"] {
                if let Some(value) = fields[field].as_str() {
                    if !value.is_empty()
                        && !value.starts_with('.')
                        && value
                            .chars()
                            .all(|c| c.is_alphanumeric() || "-_.".contains(c))
                    {
                        self.slugs.insert(value.to_owned());
                    }
                }
            }
            if let Some(hero) = fields["heroImage"].as_str() {
                self.add_url(hero)?;
            }
        }
        // Mirror the local site's Markdown image destinations and literal HTML
        // img src attributes. Code examples do not grant attachment authority.
        static IMAGE: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(
            r#"!\[[^\]\r\n]*\]\(\s*(?:<([^>\r\n]+)>|([^\s)]+))|(?i:<img\b[^>]*?\s+src\s*=\s*(?:"([^"]+)"|'([^']+)'))"#
        ).unwrap()
        });
        static INLINE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"(?s)\x60+[^\x60]*\x60+").unwrap());
        let mut fence = None;
        for line in content.lines() {
            let trimmed = line.trim_start();
            let lead = trimmed.chars().next();
            let ticks = trimmed.chars().take_while(|c| Some(*c) == lead).count();
            if matches!(lead, Some('~' | '\x60')) && ticks >= 3 {
                if let Some((mark, width)) = fence {
                    if lead == Some(mark) && ticks >= width && trimmed[ticks..].trim().is_empty() {
                        fence = None;
                    }
                } else {
                    fence = lead.map(|mark| (mark, ticks));
                }
                continue;
            }
            if fence.is_some() || line.starts_with("    ") || line.starts_with('\t') {
                continue;
            }
            let prose = INLINE.replace_all(line, "");
            for caps in IMAGE.captures_iter(&prose) {
                if let Some(url) = caps.iter().skip(1).flatten().next() {
                    self.add_url(url.as_str())?;
                }
            }
        }
        Ok(())
    }

    pub fn validate_directories(&self, root: &Path) -> Result<(), String> {
        for slug in &self.slugs {
            site::checked(root, &format!("public/images/{slug}"), true)?;
        }
        if !self.slugs.is_empty() {
            site::checked(root, "public/heroes", true)?;
        }
        Ok(())
    }

    pub fn includes(&self, path: &str) -> bool {
        if !allowed(path) {
            return false;
        }
        if self.references.contains(path) {
            return true;
        }
        if let Some(rest) = path.strip_prefix("public/images/") {
            return rest
                .split_once('/')
                .is_some_and(|(slug, _)| self.slugs.contains(slug));
        }
        path.strip_prefix("public/heroes/")
            .filter(|s| !s.contains('/'))
            .and_then(|name| name.rsplit_once('.'))
            .and_then(|(stem, _)| stem.strip_suffix("-hero"))
            .is_some_and(|slug| self.slugs.contains(slug))
    }
}

pub(super) fn checked_size(root: &Path, file: &str, deleted: bool) -> Result<Option<u64>, String> {
    if !allowed(file) {
        return Err("blog_invalid_path".into());
    }
    let path = site::checked(root, file, deleted)?;
    if deleted && !path.exists() {
        return Ok(None);
    }
    let meta = path.metadata().map_err(|_| "blog_asset_missing")?;
    if !meta.is_file() {
        return Err("blog_invalid_path".into());
    }
    if meta.len() > GITHUB_MAX_BYTES {
        return Err("blog_asset_too_large".into());
    }
    if !is_image(&path)? {
        return Err("blog_asset_not_image".into());
    }
    Ok(Some(meta.len()))
}

fn is_image(path: &Path) -> Result<bool, String> {
    let file = std::fs::File::open(path).map_err(|_| "blog_asset_missing")?;
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension == "svg" {
        use quick_xml::events::Event;
        let mut xml = quick_xml::Reader::from_reader(BufReader::new(file.take(65536)));
        let mut buffer = Vec::new();
        loop {
            match xml.read_event_into(&mut buffer) {
                Ok(Event::Start(node) | Event::Empty(node)) => {
                    return Ok(node.local_name().as_ref() == b"svg")
                }
                Ok(Event::Decl(_) | Event::Comment(_) | Event::PI(_) | Event::DocType(_)) => (),
                Ok(Event::Text(t)) if t.iter().all(u8::is_ascii_whitespace) => (),
                _ => return Ok(false),
            }
            buffer.clear();
        }
    }
    let mut header = Vec::with_capacity(64);
    file.take(64)
        .read_to_end(&mut header)
        .map_err(|_| "blog_asset_missing")?;
    Ok(image::guess_format(&header)
        .ok()
        .is_some_and(|format| Some(format) == image::ImageFormat::from_extension(extension)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_large_files_and_escapes_and_excludes_generated_variants() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        std::fs::create_dir_all(root.join("public/images/one")).unwrap();
        let file = "public/images/one/large.png";
        std::fs::File::create(root.join(file))
            .unwrap()
            .set_len(GITHUB_MAX_BYTES + 1)
            .unwrap();
        assert_eq!(
            checked_size(root, file, false).unwrap_err(),
            "blog_asset_too_large"
        );
        assert!(checked_size(root, "public/images/one/../../../outside.png", true).is_err());
        assert!(checked_size(root, "public/heroes/featured/one-hero.png", true).is_err());
        assert!(checked_size(root, "public/images/one/notes.txt", true).is_err());
        std::fs::write(root.join(file), "ordinary text").unwrap();
        assert_eq!(
            checked_size(root, file, false).unwrap_err(),
            "blog_asset_not_image"
        );
        let svg = "public/images/one/vector.svg";
        std::fs::write(
            root.join(svg),
            r#"<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>"#,
        )
        .unwrap();
        assert!(checked_size(root, svg, false).is_ok());
        std::fs::write(root.join(svg), "<html><svg/></html>").unwrap();
        assert!(checked_size(root, svg, false).is_err());
    }
}
