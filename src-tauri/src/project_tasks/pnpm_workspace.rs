//! Extract packages without constructing or expanding the rest of the YAML document.
use super::catalog::read_manifest;
use std::collections::HashSet;
use std::path::Path;
use yaml_rust2::{
    parser::{Event, Parser},
    scanner::TScalarStyle,
    Yaml,
};

struct Reader<'a> {
    parser: Parser<std::str::Chars<'a>>,
    events: usize,
}

fn is_null(event: &Event) -> bool {
    matches!(event, Event::Scalar(value, TScalarStyle::Plain, _, None) if Yaml::from_str(value) == Yaml::Null)
}

impl Reader<'_> {
    fn next(&mut self) -> Result<Event, ()> {
        self.events += 1;
        if self.events > 16384 {
            return Err(());
        }
        self.parser
            .next_token()
            .map(|(event, _)| event)
            .map_err(|_| ())
    }

    fn skip(&mut self, first: Event) -> Result<(), ()> {
        let mut depth = match first {
            Event::Scalar(..) | Event::Alias(_) => return Ok(()),
            Event::SequenceStart(..) | Event::MappingStart(..) => 1,
            _ => return Err(()),
        };
        while depth > 0 {
            match self.next()? {
                Event::SequenceStart(..) | Event::MappingStart(..) => depth += 1,
                Event::SequenceEnd | Event::MappingEnd => depth -= 1,
                Event::Scalar(..) | Event::Alias(_) => {}
                _ => return Err(()),
            }
            if depth > 64 {
                return Err(());
            }
        }
        Ok(())
    }

    fn packages(&mut self) -> Result<Option<Vec<String>>, ()> {
        let first = self.next()?;
        if is_null(&first) {
            return Ok(None);
        }
        if !matches!(first, Event::SequenceStart(_, None)) {
            return Err(());
        }
        let mut result = vec![];
        loop {
            match self.next()? {
                Event::SequenceEnd => return Ok(Some(result)),
                Event::Scalar(value, style, _, None) if result.len() < 128 => {
                    // YAML plain booleans/numbers/null are not package path strings.
                    if style == TScalarStyle::Plain
                        && !matches!(Yaml::from_str(&value), Yaml::String(_))
                    {
                        return Err(());
                    }
                    result.push(value);
                }
                _ => return Err(()),
            }
        }
    }
}

pub(super) fn read(root: &Path) -> Result<Option<Vec<String>>, ()> {
    let Some(bytes) = read_manifest(root, "pnpm-workspace.yaml").map_err(|_| ())? else {
        return Ok(None);
    };
    let text = std::str::from_utf8(&bytes).map_err(|_| ())?;
    let mut reader = Reader {
        parser: Parser::new(text.chars()),
        events: 0,
    };
    if reader.next()? != Event::StreamStart {
        return Err(());
    }
    match reader.next()? {
        Event::StreamEnd => return Ok(Some(vec!["**".into()])),
        Event::DocumentStart => {}
        _ => return Err(()),
    }
    let root_event = reader.next()?;
    if is_null(&root_event) {
        if reader.next()? != Event::DocumentEnd || reader.next()? != Event::StreamEnd {
            return Err(());
        }
        return Ok(Some(vec!["**".into()]));
    }
    if !matches!(root_event, Event::MappingStart(_, None)) {
        return Err(());
    }
    let mut keys = HashSet::new();
    let mut packages = None;
    loop {
        match reader.next()? {
            Event::MappingEnd => break,
            Event::Scalar(key, _, _, None) => {
                // Merges could hide another packages field; do not silently ignore them.
                if key == "<<" || !keys.insert(key.clone()) {
                    return Err(());
                }
                if key == "packages" {
                    packages = reader.packages()?;
                } else {
                    let first = reader.next()?;
                    reader.skip(first)?;
                }
            }
            _ => return Err(()),
        }
    }
    if reader.next()? != Event::DocumentEnd || reader.next()? != Event::StreamEnd {
        return Err(());
    }
    Ok(Some(packages.unwrap_or_else(|| vec!["**".into()])))
}
