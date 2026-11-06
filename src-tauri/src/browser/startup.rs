//! Select only the initial surface. Explicit launch intents always take precedence.
use crate::browser_store::{StartupMode, Store};

pub(crate) fn initial_app() -> Result<Option<&'static str>, String> {
    if crate::explorer_entry::tools_only() {
        return Ok(Some("core.tools"));
    }
    if crate::explorer_entry::initial_intent().is_some() || !cfg!(windows) {
        return Ok(None);
    }
    let mode = Store::open(&crate::app_paths::data_root()?.join("browser"))?
        .state("startup")?
        .startup_mode;
    Ok(default_app(mode))
}

fn default_app(mode: StartupMode) -> Option<&'static str> {
    match mode {
        StartupMode::Browser => Some("com.zicode.browser"),
        StartupMode::Workspace => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browser_default_and_workspace_opt_out() {
        assert_eq!(default_app(StartupMode::Browser), Some("com.zicode.browser"));
        assert_eq!(default_app(StartupMode::Workspace), None);
    }
}
