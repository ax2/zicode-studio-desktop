use super::*;
use yaml_rust2::{Yaml, YamlLoader};

pub(super) struct MarkdownNote {
    pub title: String,
    pub content: String,
    pub tags: Vec<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub warnings: Vec<String>,
}

pub(super) fn parse(file_name: &str, text: &str) -> Result<MarkdownNote, NotesError> {
    let text = normalize_newlines(text.trim_start_matches('\u{feff}'));
    validate_content(&text)?;
    let mut note = MarkdownNote {
        title: title_from_file_name(file_name),
        content: text.clone(),
        tags: Vec::new(),
        created_at: None,
        updated_at: None,
        warnings: Vec::new(),
    };
    let Some(rest) = text.strip_prefix("---\n") else {
        return Ok(note);
    };
    // Only consume source delimiter lines. The vault reader additionally
    // trims newlines that the Studio serializer inserts around its own body.
    let Some((header, content)) = rest
        .strip_prefix("---\n")
        .map(|body| ("", body))
        .or_else(|| rest.split_once("\n---\n"))
        .or_else(|| rest.strip_suffix("\n---").map(|header| (header, "")))
    else {
        note.warnings
            .push("Incomplete Markdown metadata was kept in the note body".into());
        return Ok(note);
    };
    if header.len() > 64 * 1024 {
        note.warnings
            .push("Oversized Markdown metadata was kept in the note body".into());
        return Ok(note);
    }

    let Ok(documents) = YamlLoader::load_from_str(header) else {
        note.warnings
            .push("Invalid Markdown metadata was kept in the note body".into());
        return Ok(note);
    };
    let [Yaml::Hash(metadata)] = documents.as_slice() else {
        note.warnings
            .push("Unsupported Markdown metadata was kept in the note body".into());
        return Ok(note);
    };
    note.content = content.to_owned();
    let field = |key: &str| metadata.get(&Yaml::String(key.to_owned()));
    if let Some(title) = field("title")
        .and_then(Yaml::as_str)
        .filter(|title| !title.trim().is_empty())
    {
        note.title = title.to_owned();
    }
    validate_title(&note.title)?;
    let (tags, invalid_tags) = match field("tags") {
        Some(Yaml::Array(tags)) => {
            let valid = tags
                .iter()
                .filter_map(Yaml::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>();
            let invalid = valid.len() != tags.len();
            (valid, invalid)
        }
        Some(Yaml::String(tags)) => (
            tags.split(',')
                .map(str::trim)
                .filter(|tag| !tag.is_empty())
                .map(str::to_owned)
                .collect(),
            false,
        ),
        None | Some(Yaml::Null) => (Vec::new(), false),
        _ => (Vec::new(), true),
    };
    note.tags = normalize_tags(tags)?;
    if invalid_tags {
        note.warnings
            .push("Non-text Markdown tags were skipped".into());
    }
    note.created_at = read_date(field("created"), "created", &mut note.warnings);
    note.updated_at = read_date(field("updated"), "updated", &mut note.warnings);
    let skipped = metadata
        .keys()
        .filter_map(Yaml::as_str)
        .filter(|key| !matches!(*key, "title" | "tags" | "created" | "updated"))
        .collect::<Vec<_>>();
    if !skipped.is_empty() {
        note.warnings.push(format!(
            "Markdown properties not imported: {}",
            skipped.join(", ")
        ));
    }
    Ok(note)
}

fn read_date(field: Option<&Yaml>, key: &str, warnings: &mut Vec<String>) -> Option<String> {
    let field = field?;
    let formatted = field.as_str().and_then(|value| {
        if let Ok(timestamp) = chrono::DateTime::parse_from_rfc3339(value) {
            return Some(timestamp.to_utc().to_rfc3339());
        }
        chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .ok()
            .and_then(|date| date.and_hms_opt(0, 0, 0))
            .map(|time| time.and_utc().to_rfc3339())
    });
    if formatted.is_none() {
        warnings.push(format!("Unsupported Markdown date property: {key}"));
    }
    formatted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_yaml_strings_lists_and_dates_from_a_markdown_note() {
        let note = parse("迁入.md", "---\ntitle: 中文笔记\ntags:\n  - 工作\n  - 项目\ncreated: 2026-11-01\naliases:\n  - 索引\n---\n# 正文\n\n[[另一篇]]\n").unwrap();
        assert_eq!(note.title, "中文笔记");
        assert_eq!(note.tags, ["工作", "项目"]);
        assert_eq!(
            note.created_at.as_deref(),
            Some("2026-11-01T00:00:00+00:00")
        );
        assert_eq!(note.content, "# 正文\n\n[[另一篇]]\n");
        assert_eq!(note.warnings, ["Markdown properties not imported: aliases"]);
    }
}
