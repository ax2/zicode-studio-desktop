//! Windows x64 full-installer channel. The renderer never supplies a URL or a local path.
use futures_util::StreamExt;
use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, WebviewWindow};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

const API: &str = "https://api.github.com/repos/ax2/zicode-studio-desktop/releases";
const DOWNLOAD: &str = "https://github.com/ax2/zicode-studio-desktop/releases/download";
const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const CANCELLED: &str = "UPDATE_CANCELLED";
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    published_at: Option<String>,
    body: Option<String>,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
    state: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct Candidate {
    version: String,
    url: String,
    size: u64,
    sha: String,
}
struct Ready {
    candidate: Candidate,
    path: PathBuf,
}
enum Stage {
    Idle,
    Download(String, CancellationToken),
    Ready(String, Ready),
    Handoff,
}
struct State {
    requests: HashMap<String, std::sync::Arc<()>>,
    checked: HashMap<String, Candidate>,
    stage: Stage,
}
static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| {
    Mutex::new(State {
        requests: HashMap::new(),
        checked: HashMap::new(),
        stage: Stage::Idle,
    })
});
fn state() -> Result<std::sync::MutexGuard<'static, State>, String> {
    STATE
        .lock()
        .map_err(|_| "Update state is unavailable".into())
}
#[derive(Clone, Serialize)]
struct Progress {
    phase: &'static str,
    downloaded: u64,
    total: u64,
}
fn progress(window: &WebviewWindow, phase: &'static str, downloaded: u64, total: u64) {
    let _ = window.emit_to(
        window.label(),
        "desktop-update-progress",
        Progress {
            phase,
            downloaded,
            total,
        },
    );
}
fn accepted_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(
            url.host_str(),
            Some(
                "github.com"
                    | "release-assets.githubusercontent.com"
                    | "objects.githubusercontent.com"
            )
        )
}
fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("ZiCode-Studio-Desktop-Updater")
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(45))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && accepted_url(attempt.url()) {
                attempt.follow()
            } else {
                attempt.error("Unapproved update redirect")
            }
        }))
        .build()
        .map_err(|_| "Could not configure the update connection".into())
}
fn select(release: &Release, current: &semver::Version) -> Result<Option<Candidate>, String> {
    let version = release
        .tag_name
        .strip_prefix('v')
        .and_then(|v| semver::Version::parse(v).ok())
        .ok_or("Invalid official release version")?;
    if release.draft || release.prerelease || !version.pre.is_empty() || !version.build.is_empty() {
        return Err("Expected an official stable release".into());
    }
    if version <= *current {
        return Ok(None);
    }
    let name = format!("ZiCode.Studio.Desktop_{version}_x64-setup.exe");
    let mut matching = release.assets.iter().filter(|a| a.name == name);
    let asset = matching
        .next()
        .ok_or("No Windows x64 installer in this release")?;
    let url = format!("{DOWNLOAD}/{}/{name}", release.tag_name);
    let digest = asset
        .digest
        .as_deref()
        .and_then(|d| d.strip_prefix("sha256:"))
        .ok_or("Missing official installer SHA-256")?;
    if matching.next().is_some()
        || asset.state != "uploaded"
        || asset.size == 0
        || asset.size > MAX_BYTES
        || asset.browser_download_url != url
        || digest.len() != 64
        || !digest.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Invalid official Windows installer metadata".into());
    }
    Ok(Some(Candidate {
        version: version.to_string(),
        url,
        size: asset.size,
        sha: digest.to_ascii_lowercase(),
    }))
}
fn installable(
    releases: Vec<Release>,
    current: &semver::Version,
) -> Result<Option<(Release, Candidate)>, String> {
    let mut stable = releases
        .into_iter()
        .filter_map(|release| {
            let version = semver::Version::parse(release.tag_name.strip_prefix('v')?).ok()?;
            let pending = release
                .body
                .as_deref()
                .and_then(|body| body.trim_end().lines().last())
                .is_some_and(|line| {
                    line.starts_with("<!-- studio-release-v1:") && line.contains(":pending:")
                });
            (!release.draft
                && !release.prerelease
                && version.pre.is_empty()
                && version.build.is_empty()
                && !pending)
                .then_some((version, release))
        })
        .collect::<Vec<_>>();
    stable.sort_unstable_by(|a, b| b.0.cmp(&a.0));
    if stable.is_empty() {
        return Err("No published stable release was available".into());
    }
    let mut invalid = None;
    for (version, release) in stable {
        if version <= *current {
            break;
        }
        match select(&release, current) {
            Ok(Some(candidate)) => return Ok(Some((release, candidate))),
            Ok(None) => continue,
            Err(error) => invalid = Some(error),
        }
    }
    invalid.map_or(Ok(None), Err)
}
async fn latest(current: &semver::Version) -> Result<Option<(Release, Candidate)>, String> {
    let client = client()?;
    let mut releases = Vec::new();
    for page in 1..=20 {
        let url = format!("{API}?per_page=100&page={page}");
        let response = client
            .get(&url)
            .header("Accept", "application/vnd.github+json")
            .header("Cache-Control", "no-cache")
            .header("Pragma", "no-cache")
            .timeout(Duration::from_secs(25))
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|_| "Could not read the official GitHub releases")?;
        if response.url().as_str() != url {
            return Err("Unexpected release metadata source".into());
        }
        let more = response
            .headers()
            .get(reqwest::header::LINK)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|value| {
                value
                    .split(',')
                    .any(|part| part.trim_end().ends_with("rel=\"next\""))
            });
        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| "Incomplete official release metadata")?;
            if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                return Err("Official release metadata exceeds limit".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let batch: Vec<Release> =
            serde_json::from_slice(&bytes).map_err(|_| "Invalid official release metadata")?;
        releases.extend(batch);
        if !more {
            return installable(releases, current);
        }
    }
    Err("Official release catalog exceeds limit".into())
}
pub(super) async fn check(
    window: &WebviewWindow,
    current: &semver::Version,
) -> Result<Option<super::desktop_updates::DesktopUpdateInfo>, String> {
    let request = std::sync::Arc::new(());
    {
        let mut state = state()?;
        state.checked.remove(window.label());
        state
            .requests
            .insert(window.label().into(), request.clone());
    }
    let result = latest(current).await;
    let mut state = state()?;
    if !state
        .requests
        .get(window.label())
        .is_some_and(|active| std::sync::Arc::ptr_eq(active, &request))
    {
        return Err("Update check superseded".into());
    }
    state.requests.remove(window.label());
    if let Some((release, candidate)) = result? {
        let info = super::desktop_updates::DesktopUpdateInfo::full(
            candidate.version.clone(),
            release.published_at,
            release.body,
        );
        state.checked.insert(window.label().into(), candidate);
        Ok(Some(info))
    } else {
        Ok(None)
    }
}
fn directory() -> Result<PathBuf, String> {
    Ok(crate::app_paths::data_root()?.join("desktop-updates"))
}
async fn download(
    window: &WebviewWindow,
    c: &Candidate,
    file: tokio::fs::File,
) -> Result<(), String> {
    let response = client()?
        .get(&c.url)
        .timeout(Duration::from_secs(30 * 60))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|_| "Installer download failed")?;
    if !accepted_url(response.url()) || response.content_length().is_some_and(|n| n != c.size) {
        return Err("Installer source or length changed".into());
    }
    write_verified(file, response.bytes_stream(), c, |phase, count| {
        progress(window, phase, count, c.size)
    })
    .await
}
async fn write_verified<E>(
    mut file: tokio::fs::File,
    stream: impl futures_util::Stream<Item = Result<bytes::Bytes, E>>,
    c: &Candidate,
    mut notify: impl FnMut(&'static str, u64),
) -> Result<(), String> {
    futures_util::pin_mut!(stream);
    let mut hash = Sha256::new();
    let mut count = 0;
    let mut last = Instant::now();
    while let Some(block) = stream.next().await {
        let block = block.map_err(|_| "Installer download interrupted")?;
        count += block.len() as u64;
        if count > c.size {
            return Err("Installer exceeds advertised size".into());
        }
        file.write_all(&block)
            .await
            .map_err(|_| "Cannot write installer file")?;
        hash.update(&block);
        if last.elapsed() >= Duration::from_millis(200) {
            notify("downloading", count);
            last = Instant::now()
        }
    }
    notify("verifying", count);
    if count != c.size || format!("{:x}", hash.finalize()) != c.sha {
        return Err("Installer size or SHA-256 mismatch".into());
    }
    file.sync_all()
        .await
        .map_err(|_| "Cannot finish writing the installer".into())
}
pub(super) async fn install(
    window: &WebviewWindow,
    expected: &str,
    current: &semver::Version,
) -> Result<(), String> {
    let dir = directory()?;
    let path = dir.join(format!("candidate-{}.exe", uuid::Uuid::new_v4()));
    let token = CancellationToken::new();
    let checked = {
        let mut state = state()?;
        if !matches!(state.stage, Stage::Idle) {
            return Err("An update is already in progress".into());
        }
        let c = state
            .checked
            .get(window.label())
            .filter(|c| c.version == expected)
            .cloned()
            .ok_or("Check the available update again")?;
        state.stage = Stage::Download(window.label().into(), token.clone());
        c
    };
    progress(window, "downloading", 0, checked.size);
    let mut owned_file = false;
    let work = async {
        let candidate = latest(current).await?.map(|(_, candidate)| candidate);
        if candidate.as_ref() != Some(&checked) {
            return Err("Official installer changed. Check again.".into());
        }
        tokio::fs::create_dir_all(&dir)
            .await
            .map_err(|_| "Cannot create the update directory")?;
        let file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .map_err(|_| "Cannot create installer file")?;
        owned_file = true;
        download(window, &checked, tokio::fs::File::from_std(file)).await
    };
    let result = tokio::select! {biased; _=token.cancelled()=>Err(CANCELLED.to_string()), result=work=>result};
    let result = {
        let mut state = state()?;
        let result = if token.is_cancelled() {
            Err(CANCELLED.to_string())
        } else {
            result
        };
        if result.is_ok() {
            state.stage = Stage::Ready(
                window.label().into(),
                Ready {
                    candidate: checked.clone(),
                    path: path.clone(),
                },
            );
        } else {
            state.stage = Stage::Idle
        }
        result
    };
    match result {
        Ok(()) => {
            progress(window, "ready", checked.size, checked.size);
            Ok(())
        }
        Err(e) => {
            if owned_file {
                let _ = tokio::fs::remove_file(path).await;
            }
            progress(
                window,
                if e == CANCELLED {
                    "cancelled"
                } else {
                    "failed"
                },
                0,
                checked.size,
            );
            Err(e)
        }
    }
}
pub(super) fn cancel(window: &WebviewWindow) -> Result<(), String> {
    let mut s = state()?;
    match &s.stage {
        Stage::Download(owner, token) if owner == window.label() => {
            token.cancel();
            Ok(())
        }
        Stage::Ready(owner, ready) if owner == window.label() => {
            std::fs::remove_file(&ready.path).map_err(|_| "Cannot remove staged installer")?;
            s.stage = Stage::Idle;
            progress(window, "cancelled", 0, 0);
            Ok(())
        }
        Stage::Idle => Ok(()),
        _ => Err("Update handoff cannot be cancelled from this window".into()),
    }
}
pub(super) fn forget_window(label: &str) {
    if let Ok(mut state) = state() {
        state.requests.remove(label);
        state.checked.remove(label);
        match &state.stage {
            Stage::Download(owner, token) if owner == label => token.cancel(),
            Stage::Ready(owner, ready) if owner == label => {
                let _ = std::fs::remove_file(&ready.path);
                state.stage = Stage::Idle;
            }
            _ => {}
        }
    }
}
pub(super) fn pending_quit_update() -> Option<(String, String)> {
    if crate::desktop_updates::update_mode(None).ok()?
        != crate::desktop_updates::UpdateMode::Download
    {
        return None;
    }
    match &state().ok()?.stage {
        Stage::Ready(owner, ready) => Some((owner.clone(), ready.candidate.version.clone())),
        _ => None,
    }
}

pub(super) async fn handoff(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    relaunch: bool,
) -> Result<bool, String> {
    let dir = directory()?;
    let ready = {
        let mut state = state()?;
        if matches!(state.stage, Stage::Idle) {
            return Ok(false);
        }
        if !matches!(&state.stage,Stage::Ready(owner,_) if owner==window.label()) {
            return Err("Installer is not ready for this window".into());
        }
        let Stage::Ready(_, ready) = std::mem::replace(&mut state.stage, Stage::Handoff) else {
            unreachable!()
        };
        ready
    };
    let outcome = async {
        crate::reserve_background_worker_for_update(app, window).await?;
        let path = ready.path.clone();
        let c = ready.candidate.clone();
        let r = tauri::async_runtime::spawn_blocking(move || {
            crate::desktop_update_handoff::start(&path, &c.sha, &c.version, &dir, relaunch)
        })
        .await
        .map_err(|_| "Installer helper stopped unexpectedly".to_string())
        .and_then(|v| v);
        if r.is_err() {
            let _ = crate::release_background_worker_update_lease(app, window, true).await;
        }
        r
    }
    .await;
    if let Err(error) = outcome {
        state()?.stage = Stage::Ready(window.label().into(), ready);
        return Err(error);
    }
    app.exit(0);
    Ok(true)
}
use crate::desktop_updates::ResultNotice;
#[derive(Deserialize)]
struct Receipt {
    version: String,
    status: String,
    message: String,
}
pub(super) fn take_result() -> Result<Option<ResultNotice>, String> {
    take_result_at(&directory()?)
}
fn take_result_at(dir: &std::path::Path) -> Result<Option<ResultNotice>, String> {
    let source = dir.join("result.json");
    let taking = dir.join(format!("result-{}.json", uuid::Uuid::new_v4()));
    match std::fs::rename(&source, &taking) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Cannot read the installer result".into()),
    }
    let result = (|| {
        let r: Receipt = serde_json::from_slice(
            &std::fs::read(&taking).map_err(|_| "Cannot read installer result")?,
        )
        .map_err(|_| "Invalid installer result")?;
        if semver::Version::parse(&r.version).is_err()
            || !matches!(r.status.as_str(), "installed" | "failed")
        {
            return Err("Invalid installer outcome".into());
        }
        Ok(Some(ResultNotice {
            version: r.version,
            success: r.status == "installed",
            message: r.message,
        }))
    })();
    let _ = std::fs::remove_file(taking);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_terminal_installer_receipts_are_consumed_once() {
        let dir =
            std::env::temp_dir().join(format!("studio-update-result-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        for (status, expected) in [
            ("ready", None),
            ("installed", Some(true)),
            ("failed", Some(false)),
        ] {
            std::fs::write(
                dir.join("result.json"),
                serde_json::json!({"version":"1.0.0","status":status,"message":""}).to_string(),
            )
            .unwrap();
            assert_eq!(
                take_result_at(&dir).ok().flatten().map(|r| r.success),
                expected
            );
            assert!(take_result_at(&dir).unwrap().is_none());
        }
        std::fs::remove_dir(dir).unwrap();
    }
    #[tokio::test]
    async fn installer_bytes_must_match_both_announced_size_and_digest() {
        let bytes = bytes::Bytes::from_static(b"installer data");
        let hash = format!("{:x}", Sha256::digest(&bytes));
        for (size, sha, expected) in [
            (bytes.len() as u64, hash.clone(), true),
            (2, hash.clone(), false),
            (100, hash, false),
            (bytes.len() as u64, "00".repeat(32), false),
        ] {
            let c = Candidate {
                version: "1.0.0".into(),
                url: "fixture".into(),
                size,
                sha,
            };
            let path =
                std::env::temp_dir().join(format!("studio-update-digest-{}", uuid::Uuid::new_v4()));
            let file = tokio::fs::File::create_new(&path).await.unwrap();
            let stream =
                futures_util::stream::iter([Ok::<_, ()>(bytes.slice(..3)), Ok(bytes.slice(3..))]);
            let result = write_verified(file, stream, &c, |_, _| {}).await;
            if result.is_ok() {
                assert_eq!(tokio::fs::read(&path).await.unwrap(), bytes);
            }
            tokio::fs::remove_file(path).await.unwrap();
            assert_eq!(result.is_ok(), expected);
        }
    }
    fn release() -> Release {
        let name = "ZiCode.Studio.Desktop_0.6.2_x64-setup.exe".to_string();
        Release {
            tag_name: "v0.6.2".into(),
            draft: false,
            prerelease: false,
            published_at: None,
            body: None,
            assets: vec![Asset {
                browser_download_url: format!("{DOWNLOAD}/v0.6.2/{name}"),
                name,
                size: 368501225,
                state: "uploaded".into(),
                digest: Some(format!("sha256:{}", "bc".repeat(32))),
            }],
        }
    }
    #[test]
    fn newer_official_asset_is_version_architecture_size_and_digest_bound() {
        let base = semver::Version::new(0, 6, 1);
        let mut r = release();
        assert_eq!(select(&r, &base).unwrap().unwrap().size, 368501225);
        assert!(select(&r, &semver::Version::new(0, 6, 2))
            .unwrap()
            .is_none());
        assert!(select(&r, &semver::Version::new(1, 0, 0))
            .unwrap()
            .is_none());
        r.assets[0].digest = None;
        assert!(select(&r, &base).is_err());
        r = release();
        r.assets[0].size = 0;
        assert!(select(&r, &base).is_err());
        r = release();
        r.assets[0].browser_download_url.push_str("?mirror");
        assert!(select(&r, &base).is_err());
        r = release();
        r.assets[0].name = r.assets[0].name.replace("x64", "arm64");
        assert!(select(&r, &base).is_err());
        r = release();
        r.assets.push(release().assets.remove(0));
        assert!(select(&r, &base).is_err());
        r = release();
        r.prerelease = true;
        assert!(select(&r, &base).is_err());
    }
    #[test]
    fn catalog_uses_highest_installable_version_even_if_listing_is_unsorted() {
        fn at(version: &str) -> Release {
            let mut release = release();
            release.tag_name = format!("v{version}");
            release.assets[0].name = format!("ZiCode.Studio.Desktop_{version}_x64-setup.exe");
            release.assets[0].browser_download_url =
                format!("{DOWNLOAD}/v{version}/{}", release.assets[0].name);
            release
        }
        let base = semver::Version::new(0, 7, 0);
        let mut partial = at("0.8.0");
        partial.assets[0].digest = None;
        let mut pending = at("0.7.3");
        pending.body = Some("notes\n\n<!-- studio-release-v1:abc:def:pending:123 -->".into());
        let catalog = vec![
            at("0.7.1"),
            pending,
            at("1.0.0-beta.1"),
            partial,
            at("0.7.2"),
        ];
        assert_eq!(
            installable(catalog, &base).unwrap().unwrap().1.version,
            "0.7.2"
        );
        assert!(installable(vec![at("0.7.0")], &base).unwrap().is_none());
        let mut invalid = at("0.7.2");
        invalid.assets.clear();
        assert!(installable(vec![invalid], &base).is_err());
    }

    #[tokio::test]
    #[ignore = "read-only official GitHub release metadata; requires network"]
    async fn official_catalog_read_only_from_v070() {
        let (_, next) = latest(&semver::Version::new(0, 7, 0))
            .await
            .unwrap()
            .unwrap();
        assert!(semver::Version::parse(&next.version).unwrap() >= semver::Version::new(0, 7, 2));
        println!(
            "verified published Windows x64 v{}; {} bytes; sha256 {}",
            next.version, next.size, next.sha
        );
    }
    #[test]
    fn only_standard_https_github_asset_origins_can_follow_redirects() {
        for url in [
            "https://release-assets.githubusercontent.com/download",
            "https://objects.githubusercontent.com/asset",
            DOWNLOAD,
        ] {
            assert!(accepted_url(&Url::parse(url).unwrap()))
        }
        for url in [
            "http://github.com/download",
            "https://github.com.example.test/a",
            "https://user@github.com/a",
            "https://github.com:8443/a",
            "https://127.0.0.1/a",
        ] {
            assert!(!accepted_url(&Url::parse(url).unwrap()))
        }
    }
}
