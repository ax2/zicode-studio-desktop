use super::site;
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use yaml_rust2::{
    parser::{Event, Parser},
    Yaml, YamlLoader,
};

#[derive(Serialize)]
pub(super) struct Summary {
    title: String,
    categories: Vec<String>,
    tags: Vec<String>,
}

fn strings(value: &Yaml) -> Vec<String> {
    if let Some(s) = value.as_str() {
        return vec![s.to_owned()];
    }
    value
        .as_vec()
        .into_iter()
        .flatten()
        .filter_map(Yaml::as_str)
        .map(str::to_owned)
        .collect()
}

pub(super) fn metadata(reader: impl Read) -> Option<Yaml> {
    let mut lines = BufReader::new(reader.take(16 * 1024)).lines();
    if lines
        .next()?
        .ok()?
        .trim_start_matches('\u{feff}')
        .trim_end()
        != "---"
    {
        return None;
    }
    let mut header = String::new();
    loop {
        let line = lines.next()?.ok()?;
        if line.trim_end() == "---" {
            break;
        }
        header.push_str(&line);
        header.push('\n');
    }
    // Directory scans should never expand aliases or deeply nested metadata.
    let mut parser = Parser::new_from_str(&header);
    let mut depth = 0usize;
    loop {
        match parser.next_token().ok()?.0 {
            Event::Alias(_) => return None,
            Event::SequenceStart(..) | Event::MappingStart(..) => {
                depth += 1;
                if depth > 32 {
                    return None;
                }
            }
            Event::SequenceEnd | Event::MappingEnd => depth = depth.checked_sub(1)?,
            Event::StreamEnd => break,
            _ => {}
        }
    }
    YamlLoader::load_from_str(&header).ok()?.into_iter().next()
}

fn summary(file: File) -> Option<Summary> {
    let doc = metadata(file)?;
    Some(Summary {
        title: doc["title"].as_str()?.to_owned(),
        categories: strings(&doc["category"]),
        tags: strings(&doc["tags"]),
    })
}

pub(super) fn summaries(root: &Path, paths: &[String]) -> BTreeMap<String, Summary> {
    paths
        .iter()
        .filter_map(|key| {
            let file = File::open(site::resolve(root, key, false).ok()?).ok()?;
            Some((key.clone(), summary(file)?))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Seek, Write};

    #[test]
    fn reads_multiline_metadata_without_processing_the_body() {
        let mut file = tempfile::tempfile().unwrap();
        file.write_all(
            b"---\r\ntitle: 'A: B'\r\ncategory: Docs\r\ntags:\r\n  - test\r\n---\r\n\xff",
        )
        .unwrap();
        file.rewind().unwrap();
        let found = summary(file).unwrap();
        assert_eq!(found.title, "A: B");
        assert_eq!(found.categories, ["Docs"]);
        assert_eq!(found.tags, ["test"]);
    }
}
