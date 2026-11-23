use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tempfile::NamedTempFile;

pub(super) const COLLECTION: &str = "src/content/blog";
pub(super) const PICKS: &str = "src/lib/homepagePicks.ts";
const MAX_BYTES: u64 = 8 * 1024 * 1024;

fn linked(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

pub(super) fn checked(root: &Path, relative: &str, allow_missing: bool) -> Result<PathBuf, String> {
    let mut target = root.to_owned();
    let mut parts = relative.split('/').peekable();
    while let Some(part) = parts.next() {
        let reserved = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty()
            || part.starts_with('.')
            || part.ends_with(['.', ' '])
            || part.contains(['\\', ':', '<', '>', '"', '|', '?', '*'])
            || part.chars().any(char::is_control)
            || matches!(
                reserved.as_str(),
                "CON" | "NUL" | "PRN" | "AUX" | "CONOUT$" | "CONIN$"
            )
            || reserved
                .strip_prefix("COM")
                .or_else(|| reserved.strip_prefix("LPT"))
                .is_some_and(|n| n.len() == 1 && n.as_bytes()[0].is_ascii_digit())
        {
            return Err("blog_invalid_path".into());
        }
        target.push(part);
        match fs::symlink_metadata(&target) {
            Ok(meta) if !linked(&meta) && (parts.peek().is_none() || meta.is_dir()) => (),
            Err(e) if allow_missing && e.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err("blog_invalid_path".into()),
        }
    }
    Ok(target)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Layout {
    Astro,
    Hugo(&'static str),
}

impl Layout {
    pub(super) fn at(root: &Path) -> Result<Self, String> {
        if [
            "astro.config.mjs",
            "astro.config.ts",
            "astro.config.js",
            "astro.config.mts",
            "astro.config.cjs",
        ]
        .iter()
        .any(|name| checked(root, name, false).is_ok_and(|p| p.is_file()))
            && checked(root, COLLECTION, false).is_ok_and(|p| p.is_dir())
        {
            return Ok(Self::Astro);
        }
        if ["hugo.toml", "hugo.yaml", "hugo.yml", "hugo.json"]
            .iter()
            .any(|name| checked(root, name, false).is_ok_and(|p| p.is_file()))
        {
            for collection in ["content/posts", "content/post", "content/blog"] {
                if checked(root, collection, false).is_ok_and(|p| p.is_dir()) {
                    return Ok(Self::Hugo(collection));
                }
            }
        }
        Err("blog_invalid_site".into())
    }

    pub(super) fn framework(self) -> &'static str {
        match self {
            Self::Astro => "astro",
            Self::Hugo(_) => "hugo",
        }
    }

    pub(super) fn collection(self) -> &'static str {
        match self {
            Self::Astro => COLLECTION,
            Self::Hugo(collection) => collection,
        }
    }

    pub(super) fn picks(self) -> Option<&'static str> {
        (self == Self::Astro).then_some(PICKS)
    }

    pub(super) fn category_field(self) -> &'static str {
        match self {
            Self::Astro => "category",
            Self::Hugo(_) => "categories",
        }
    }

    pub(super) fn resolve(self, root: &Path, key: &str, new: bool) -> Result<PathBuf, String> {
        let path = checked(root, &self.relative(key)?, new && key != "@homepagePicks")?;
        if path.exists() && !path.is_file() {
            return Err("blog_invalid_path".into());
        }
        Ok(path)
    }

    pub(super) fn relative(self, key: &str) -> Result<String, String> {
        if key == "@homepagePicks" {
            return self
                .picks()
                .map(str::to_owned)
                .ok_or("blog_invalid_path".into());
        }
        let path = Path::new(key);
        let extension = path.extension().and_then(|s| s.to_str());
        let valid = match self {
            Self::Astro => matches!(extension, Some("md" | "mdx")),
            Self::Hugo(_) => {
                extension == Some("md") && path.file_name().is_some_and(|name| name != "_index.md")
            }
        };
        if !valid {
            return Err("blog_invalid_path".into());
        }
        Ok(format!("{}/{key}", self.collection()))
    }
}

pub(super) fn detect(selected: &Path) -> Result<PathBuf, String> {
    let root = selected.canonicalize().map_err(|_| "blog_invalid_site")?;
    if Layout::at(&root).is_ok() {
        return Ok(root);
    }
    let sub = checked(&root, "astro-site", false).map_err(|_| "blog_invalid_site")?;
    (Layout::at(&sub)? == Layout::Astro)
        .then_some(sub)
        .ok_or("blog_invalid_site".into())
}

pub(super) fn resolve(root: &Path, key: &str, new: bool) -> Result<PathBuf, String> {
    Layout::at(root)?.resolve(root, key, new)
}

pub(super) fn list(root: &Path) -> Result<Vec<String>, String> {
    let layout = Layout::at(root)?;
    let root = checked(root, layout.collection(), false)?;
    let mut directories = vec![root.clone()];
    let mut paths = vec![];
    while let Some(directory) = directories.pop() {
        for entry in fs::read_dir(directory).map_err(|_| "blog_read_failed")? {
            let entry = entry.map_err(|_| "blog_read_failed")?;
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let path = entry.path();
            let meta = path.symlink_metadata().map_err(|_| "blog_read_failed")?;
            if linked(&meta) {
                continue;
            }
            if meta.is_dir() {
                directories.push(path);
                continue;
            }
            if meta.is_file() {
                let name = path
                    .strip_prefix(&root)
                    .ok()
                    .and_then(Path::to_str)
                    .ok_or("blog_invalid_path")?
                    .replace(std::path::MAIN_SEPARATOR, "/");
                if layout.relative(&name).is_ok() {
                    paths.push(name);
                }
            }
        }
    }
    paths.sort();
    Ok(paths)
}

pub(super) fn read(path: &Path) -> Result<String, String> {
    let mut text = String::new();
    fs::File::open(path)
        .map_err(|_| "blog_read_failed")?
        .take(MAX_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|_| "blog_read_failed")?;
    if text.len() as u64 > MAX_BYTES {
        return Err("blog_file_too_large".into());
    }
    Ok(text)
}

pub(super) fn replace(path: &Path, bytes: &[u8], exclusive: bool) -> Result<(), String> {
    let mut temp = NamedTempFile::new_in(path.parent().ok_or("blog_invalid_path")?)
        .map_err(|_| "blog_write_failed")?;
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "blog_write_failed")?;
    if let Ok(meta) = fs::metadata(path) {
        temp.as_file()
            .set_permissions(meta.permissions())
            .map_err(|_| "blog_write_failed")?;
    }
    if exclusive {
        temp.persist_noclobber(path)
    } else {
        temp.persist(path)
    }
    .map_err(|e| {
        if e.error.kind() == std::io::ErrorKind::AlreadyExists {
            "blog_file_changed"
        } else {
            "blog_write_failed"
        }
    })?;
    Ok(())
}

pub(super) fn save(
    root: &Path,
    key: &str,
    new: &str,
    expected: Option<&str>,
) -> Result<(), String> {
    if new.len() as u64 > MAX_BYTES {
        return Err("blog_file_too_large".into());
    }
    let path = resolve(root, key, expected.is_none())?;
    if let Some(old) = expected {
        if read(&path)? != old {
            return Err("blog_file_changed".into());
        }
    }
    if key == "@homepagePicks" {
        let original = expected
            .and_then(pick_scaffolding)
            .ok_or("blog_invalid_picks")?;
        if pick_scaffolding(new) != Some(original) {
            return Err("blog_invalid_picks".into());
        }
    }
    replace(&path, new.as_bytes(), expected.is_none())
}

// Only the article rows may change. Keep the declaration, documentation,
// standalone comments and all code around the list byte-for-byte intact.
fn pick_scaffolding(source: &str) -> Option<Vec<&str>> {
    let mut fixed = Vec::new();
    let (mut opened, mut closed) = (false, false);
    for line in source.split_inclusive('\n') {
        let row = line.trim();
        if !opened {
            fixed.push(line);
            let packed = row.split_ascii_whitespace().collect::<String>();
            opened = matches!(
                packed.as_str(),
                "exportconstHOME_PICKS:string[]=[" | "exportconstHOME_PICKS=["
            );
        } else if closed || row == "]" || row == "];" {
            closed = true;
            fixed.push(line);
        } else if row.is_empty() || row.starts_with("//") {
            fixed.push(line);
        } else {
            let q = row.chars().next()?;
            if !matches!(q, '\'' | '"') {
                return None;
            }
            let (slug, rest) = row[1..].split_once(q)?;
            if slug.is_empty()
                || !slug
                    .chars()
                    .all(|c| c.is_alphanumeric() || "-_./%~".contains(c))
            {
                return None;
            }
            let rest = rest.trim();
            let tail = rest.strip_prefix(',').unwrap_or(rest).trim();
            if !tail.is_empty()
                && (!tail.starts_with("//") || tail.contains(['\u{2028}', '\u{2029}', '\r']))
            {
                return None;
            }
        }
    }
    (opened && closed).then_some(fixed)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn directory_link_cannot_read_or_replace_files_outside_the_blog() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let posts = root.join(COLLECTION);
        let outside = root.join("outside");
        fs::create_dir_all(&posts).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("private.md"), "intact").unwrap();
        #[cfg(windows)]
        {
            // Junctions exercise the same reparse-point boundary without
            // requiring the Windows symbolic-link creation privilege.
            let status = crate::process_command::new_command("cmd.exe")
                .args(["/d", "/c", "mklink", "/J", "linked", r"..\..\..\outside"])
                .current_dir(crate::process_command::working_directory(&posts))
                .output()
                .unwrap();
            assert!(status.status.success(), "{:?}", status.status);
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, posts.join("linked")).unwrap();
        assert!(list(&root).unwrap().is_empty());
        assert!(resolve(&root, "linked/private.md", false).is_err());
        assert!(save(&root, "linked/private.md", "changed", Some("intact")).is_err());
        assert_eq!(
            fs::read_to_string(outside.join("private.md")).unwrap(),
            "intact"
        );
    }
    #[test]
    fn recommendations_can_only_edit_literal_article_rows() {
        let before = "export const HOME_PICKS: string[] = [\n  'old',\n];\n";
        let after = before.replace("'old'", "'中文-1'");
        assert_eq!(pick_scaffolding(before), pick_scaffolding(&after));
        assert!(pick_scaffolding(&before.replace("'old'", "compute()")).is_none());
        assert_ne!(
            pick_scaffolding(before),
            pick_scaffolding(&format!("{after}run();"))
        );
    }
    #[test]
    fn saves_nested_markdown_without_overwriting_another_revision() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        fs::create_dir_all(root.join(COLLECTION).join("en")).unwrap();
        fs::write(root.join("astro.config.mjs"), "").unwrap();
        assert_eq!(detect(&root).unwrap(), root);
        save(&root, "en/hello.md", "hi", None).unwrap();
        assert_eq!(list(&root).unwrap(), ["en/hello.md"]);
        assert!(save(&root, "en/hello.md", "other", None).is_err());
        assert!(save(&root, "en/hello.md", "wrong", Some("obsolete")).is_err());
        save(&root, "en/hello.md", "updated", Some("hi")).unwrap();
        for bad in [
            "../x.md",
            "en/../x.md",
            "./x.md",
            "x.md:abc.md",
            "en\\bad.md",
            "COM1.md",
            "/.git/config.md",
            "x.ts",
        ] {
            assert!(resolve(&root, bad, true).is_err(), "{bad}");
        }
    }
}
