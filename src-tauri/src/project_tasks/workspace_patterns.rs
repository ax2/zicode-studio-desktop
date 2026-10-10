//! Matching only: filesystem traversal stays in the bounded discovery layer.
use glob::{MatchOptions, Pattern};

const OPTIONS: MatchOptions = MatchOptions {
    case_sensitive: true,
    require_literal_separator: true,
    require_literal_leading_dot: true,
};

pub(super) struct WorkspacePattern {
    pub parts: Vec<Part>,
    pattern: Pattern,
}

pub(super) enum Part {
    Literal(String),
    Wildcard(Pattern),
    Recursive,
}

impl Part {
    pub fn matches(&self, name: &str) -> bool {
        match self {
            Self::Literal(value) => value == name,
            Self::Wildcard(pattern) => pattern.matches_with(name, OPTIONS),
            Self::Recursive => true,
        }
    }
}

impl WorkspacePattern {
    pub fn parse(raw: &str) -> Result<Self, ()> {
        if raw.is_empty()
            || raw.len() > 2048
            || raw.starts_with(['/', '!'])
            || raw.contains(['\\', ':', '\0', '{', '}', '(', ')'])
        {
            return Err(());
        }
        let is_root = matches!(raw, "." | "./");
        let raw = if is_root { "" } else { raw };
        let raw = raw.strip_prefix("./").unwrap_or(raw);
        let raw = raw.strip_suffix('/').unwrap_or(raw);
        let parts: Vec<_> = if raw.is_empty() {
            vec![]
        } else {
            raw.split('/').collect()
        };
        // Do not normalize absolute or repeated separators into workspace paths.
        if raw.is_empty() && !is_root {
            return Err(());
        }
        if parts.len() > 32
            || parts
                .iter()
                .any(|part| part.is_empty() || *part == "." || *part == "..")
        {
            return Err(());
        }
        // Match a synthetic child as well, so a trailing ** can consume zero directories.
        let with_child = if raw.is_empty() {
            "_".to_owned()
        } else {
            format!("{raw}/_")
        };
        let pattern = Pattern::new(&with_child).map_err(|_| ())?;
        let parts = parts
            .into_iter()
            .map(|part| {
                if part == "**" {
                    Ok(Part::Recursive)
                } else if part.contains(['*', '?', '[', ']']) {
                    Ok(Part::Wildcard(Pattern::new(part).map_err(|_| ())?))
                } else {
                    Ok(Part::Literal(part.to_owned()))
                }
            })
            .collect::<Result<_, ()>>()?;
        Ok(Self { parts, pattern })
    }

    pub fn matches(&self, path: &str) -> bool {
        let with_child = if path.is_empty() {
            "_".to_owned()
        } else {
            format!("{path}/_")
        };
        self.pattern.matches_with(&with_child, OPTIONS)
    }
}
