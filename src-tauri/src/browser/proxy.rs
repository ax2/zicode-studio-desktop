//! Browser-process settings are immutable for each WebView2 user data folder.
use super::proxy_endpoint::HttpProxy;
use crate::browser_store::Store;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};

#[derive(Default)]
struct ProcessProxies(HashMap<PathBuf, Option<HttpProxy>>);

impl ProcessProxies {
    fn active(&mut self, directory: &Path, saved: &Option<HttpProxy>) -> Option<HttpProxy> {
        self.0
            .entry(directory.to_path_buf())
            .or_insert_with(|| saved.clone())
            .clone()
    }
}

static PROXIES: LazyLock<Mutex<ProcessProxies>> = LazyLock::new(Default::default);

#[derive(serde::Serialize)]
pub(super) struct ProxySettings {
    pub(super) active: Option<HttpProxy>,
    saved: Option<HttpProxy>,
}

pub(super) fn read(
    store: &Store,
    directory: &Path,
    profile: &str,
) -> Result<ProxySettings, String> {
    let mut proxies = PROXIES
        .lock()
        .map_err(|_| "Browser proxy settings unavailable")?;
    let saved = store.http_proxy(profile)?;
    let active = proxies.active(directory, &saved);
    Ok(ProxySettings { active, saved })
}

pub(super) fn save(
    store: &Store,
    directory: &Path,
    profile: &str,
    replacement: Option<HttpProxy>,
) -> Result<ProxySettings, String> {
    let mut proxies = PROXIES
        .lock()
        .map_err(|_| "Browser proxy settings unavailable")?;
    let current = store.http_proxy(profile)?;
    let active = proxies.active(directory, &current);
    store.set_http_proxy(profile, replacement.as_ref())?;
    Ok(ProxySettings {
        active,
        saved: replacement,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_freezes_defaults_and_custom_settings_per_data_folder_until_restart() {
        let mut process = ProcessProxies::default();
        let ordinary = Path::new("ordinary");
        let named = Path::new("named");
        let proxy = Some(HttpProxy::parse("http://127.0.0.1:8172").unwrap());

        assert_eq!(process.active(ordinary, &None), None);
        assert_eq!(process.active(ordinary, &proxy), None);
        assert_eq!(process.active(named, &proxy), proxy);
        assert_eq!(process.active(named, &None), proxy);

        let mut restarted = ProcessProxies::default();
        assert_eq!(restarted.active(ordinary, &proxy), proxy);
        assert_eq!(restarted.active(named, &None), None);
    }
}
