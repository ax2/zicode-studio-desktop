use std::ops::Range;
use uuid::Uuid;

pub(super) enum Reference {
    Title(String),
    Resource {
        book: String,
        note: String,
        book_range: Range<usize>,
    },
}

const SCHEME: &str = "zicode-note://";

/// Scan conservative prose regions, retaining original byte offsets for import rewrites.
fn scan_line(
    line: &str,
    offset: usize,
    inline_ticks: &mut usize,
    visit: &mut impl FnMut(Reference),
) {
    let bytes = line.as_bytes();
    let mut cursor = 0;
    while cursor < bytes.len() {
        if bytes[cursor] == b'\\' {
            cursor = (cursor + 2).min(bytes.len());
            continue;
        }
        if bytes[cursor] == b'`' {
            let start = cursor;
            while cursor < bytes.len() && bytes[cursor] == b'`' {
                cursor += 1;
            }
            let count = cursor - start;
            if *inline_ticks == 0 {
                *inline_ticks = count;
            } else if *inline_ticks == count {
                *inline_ticks = 0;
            }
            continue;
        }
        if *inline_ticks > 0 {
            cursor += 1;
            continue;
        }
        if bytes[cursor..].starts_with(b"[[") {
            if let Some(end) = line[cursor + 2..].find("]]") {
                let body = &line[cursor + 2..cursor + 2 + end];
                let title = body.split('|').next().unwrap_or("").trim();
                if !title.is_empty() && !title.contains('[') {
                    visit(Reference::Title(title.to_string()));
                }
                cursor += 2 + end + 2;
                continue;
            }
        }
        if !bytes[cursor..].starts_with(SCHEME.as_bytes())
            || (cursor > 0
                && !bytes[cursor - 1].is_ascii_whitespace()
                && !matches!(bytes[cursor - 1], b'(' | b'<'))
        {
            cursor += 1;
            continue;
        }
        let start = cursor + SCHEME.len();
        let end = start + 73;
        let Some(pair) = line.get(start..end) else {
            cursor += 1;
            continue;
        };
        let Some((book, note)) = pair.split_once('/') else {
            cursor += 1;
            continue;
        };
        if book.len() != 36
            || note.len() != 36
            || Uuid::parse_str(book).is_err()
            || Uuid::parse_str(note).is_err()
            || bytes.get(end).is_some_and(|byte| {
                byte.is_ascii_alphanumeric()
                    || matches!(byte, b'/' | b'_' | b'-' | b'%' | b'?' | b'#')
            })
        {
            cursor += 1;
            continue;
        }
        visit(Reference::Resource {
            book: book.to_ascii_lowercase(),
            note: note.to_ascii_lowercase(),
            book_range: offset + start..offset + start + 36,
        });
        cursor = end;
    }
}

pub(super) fn scan(content: &str, mut visit: impl FnMut(Reference)) {
    let mut fence: Option<(u8, usize)> = None;
    let mut offset = 0;
    let mut inline_ticks = 0;
    for line in content.split_inclusive('\n') {
        if line.trim().is_empty() {
            inline_ticks = 0;
        }
        let trimmed = line.trim_start_matches(' ');
        let indentation = line.len() - trimmed.len();
        let bytes = trimmed.as_bytes();
        let delimiter = bytes
            .first()
            .copied()
            .filter(|byte| matches!(byte, b'`' | b'~'));
        let count = delimiter.map_or(0, |byte| {
            bytes
                .iter()
                .take_while(|candidate| **candidate == byte)
                .count()
        });
        if indentation <= 3 && count >= 3 {
            if let Some((character, length)) = fence {
                if delimiter == Some(character)
                    && count >= length
                    && trimmed[count..].trim().is_empty()
                {
                    fence = None;
                }
            } else if let Some(character) = delimiter {
                fence = Some((character, count));
            }
        } else if fence.is_none()
            && indentation < 4
            && !line.starts_with('\t')
            && !trimmed.starts_with('>')
        {
            scan_line(line, offset, &mut inline_ticks, &mut visit);
        }
        offset += line.len();
    }
}
