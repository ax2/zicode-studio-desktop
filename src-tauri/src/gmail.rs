mod api;
mod attachment;
#[cfg(test)]
mod authorization_tests;
mod oauth;
pub(crate) mod reply;
mod sync;
mod store;
#[cfg(test)]
mod tests;

use oauth::{Config, Result, READ, SEND};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};
use tauri::{Manager, WebviewWindow};
use tauri_plugin_shell::ShellExt;
use tokio_util::sync::CancellationToken;
use zeroize::{Zeroize, Zeroizing};
const TOKEN: &str = "https://oauth2.googleapis.com/token";
const REVOKE: &str = "https://oauth2.googleapis.com/revoke";
const SERVICE: &str = "ZiCode Studio Gmail";
#[derive(Serialize, Deserialize)]
struct Saved {
    refresh: String,
    scope: String,
    client_id: String,
}
impl Drop for Saved {
    fn drop(&mut self) {
        self.refresh.zeroize();
    }
}
fn updated_grant(old: &Saved, refresh: Option<String>, scope: &str) -> Option<Saved> {
    let refresh = refresh.filter(|s| !s.is_empty());
    if refresh.is_none() && old.scope == scope {
        return None;
    }
    Some(Saved {
        refresh: refresh.unwrap_or_else(|| old.refresh.clone()),
        scope: scope.into(),
        client_id: old.client_id.clone(),
    })
}
fn read_secret(key: &str) -> Result<Option<Saved>> {
    let entry = keyring::Entry::new(SERVICE, key).map_err(|_| "gmail_credentials_unavailable")?;
    match entry.get_password() {
        Ok(raw) => serde_json::from_str(&Zeroizing::new(raw))
            .map(Some)
            .map_err(|_| "gmail_reauthorize"),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("gmail_credentials_unavailable"),
    }
}
fn save_secret(key: &str, saved: &Saved) -> Result<()> {
    let raw =
        Zeroizing::new(serde_json::to_string(saved).map_err(|_| "gmail_credentials_unavailable")?);
    keyring::Entry::new(SERVICE, key)
        .and_then(|e| e.set_password(&raw))
        .map_err(|_| "gmail_credentials_unavailable")
}
fn clear_secret(key: &str) -> Result<()> {
    match keyring::Entry::new(SERVICE, key).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("gmail_credentials_unavailable"),
    }
}
#[derive(Default)]
struct Gate {
    generation: u64,
    stop: CancellationToken,
}
impl Gate {
    fn invalidate(&mut self) {
        self.stop.cancel();
        self.stop = CancellationToken::new();
        self.generation = self.generation.wrapping_add(1);
    }
}
#[derive(Default)]
struct AccountGate {
    state: Mutex<Gate>,
    network: tokio::sync::Mutex<()>,
}
type Gates = Mutex<HashMap<String, Arc<AccountGate>>>;
static GATES: OnceLock<Gates> = OnceLock::new();
fn allowed(scope: &str, s: &str) -> bool {
    scope.split_ascii_whitespace().any(|x| x == s)
}
fn consent_scope(requested: &str, granted: &str) -> String {
    [READ, SEND]
        .into_iter()
        .filter(|s| allowed(requested, s) && allowed(granted, s))
        .collect::<Vec<_>>()
        .join(" ")
}
fn perms(scopes: &str) -> Value {
    json!({"connected":true,"read":allowed(scopes,READ),"send":allowed(scopes,SEND)})
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(crate) enum Request {
    Status,
    Connect {
        send: bool,
    },
    Cancel,
    Disconnect {
        #[serde(default, rename = "clearCache")]
        clear_cache: bool,
    },
    CachedLabels,
    Labels,
    List {
        label: Option<String>,
        cursor: Option<String>,
        limit: u8,
    },
    CachedPage {
        label: Option<String>,
        cursor: Option<String>,
        limit: u8,
    },
    Read {
        id: String,
    },
    CachedBody {
        id: String,
    },
    ReplyDraft {
        id: String,
    },
    DownloadAttachment {
        id: String,
        part: usize,
    },
    #[serde(rename_all = "camelCase")]
    Send {
        draft_id: String,
        revision: i64,
        confirmed: bool,
    },
    #[serde(rename_all = "camelCase")]
    Delivery {
        draft_id: String,
        revision: i64,
    },
}
#[tauri::command]
pub(crate) async fn mail_gmail(
    window: WebviewWindow,
    account_id: String,
    request: Request,
) -> std::result::Result<Value, String> {
    crate::require_workspace_window(&window)?;
    let handles = window
        .try_state::<crate::WindowWorkspaceState>()
        .ok_or("gmail_workspace_unavailable")?;
    let scope = handles
        .0
        .lock()
        .map_err(|_| "gmail_workspace_unavailable")?
        .get(window.label())
        .cloned()
        .ok_or("gmail_workspace_unavailable")?;
    let root = crate::app_paths::data_root()?
        .canonicalize()
        .map_err(|_| "gmail_account_unavailable")?;
    if !api::valid_id(&account_id) {
        return Err("gmail_invalid".into());
    }
    let path = root.join("mail").join("mail.sqlite3");
    let address = store::address(&path, &scope, &account_id)?;
    let cache_epoch = match request {
        Request::Labels | Request::List { .. } | Request::Read { .. } | Request::DownloadAttachment { .. } => {
            store::cache_generation(&path, &scope, &account_id)?
        }
        _ => 0,
    };
    let key = format!(
        "{:x}",
        Sha256::digest(format!(
            "{}\0{}\0{}\0{}",
            root.to_string_lossy().to_lowercase(),
            crate::desktop_profile::test_profile_name().unwrap_or(""),
            scope,
            account_id
        ))
    );
    let gate = GATES
        .get_or_init(Default::default)
        .lock()
        .map_err(|_| "gmail_unavailable")?
        .entry(key.clone())
        .or_default()
        .clone();
    let key_for = |label: Option<&str>, cursor: &Option<String>, limit: u8| -> Result<String> {
        let label = label.unwrap_or("INBOX");
        if !api::valid_id(label) || !(1..=30).contains(&limit) || cursor.as_ref().is_some_and(|v| v.len() > 2048) {
            Err("gmail_invalid")
        } else {
            let page = format!("{}:{}", limit, cursor.as_deref().unwrap_or(""));
            Ok(if label == "INBOX" { page } else { format!("label:{label}:{page}") })
        }
    };
    match &request {
        Request::CachedLabels => return Ok(store::cached(&path, &scope, &account_id, "labels", "")?),
        Request::CachedPage { label, cursor, limit } => {
            let key = key_for(label.as_deref(), cursor, *limit)?;
            return Ok(sync::offline_page(&path,&scope,&account_id,label.as_deref().unwrap_or("INBOX"),cursor.as_deref(),*limit,&key)?);

        }
        Request::CachedBody { id } => {
            return Ok(store::cached(&path, &scope, &account_id, "body", id)?)
        }
        Request::ReplyDraft { id } => {
            return Ok(store::reply_draft(&path, &scope, &account_id, id)?)
        }
        Request::Delivery { draft_id, revision } => {
            return Ok(store::delivery(
                &path,
                &scope,
                &account_id,
                draft_id,
                *revision,
            )?)
        }
        Request::Cancel => {
            gate.state
                .lock()
                .map_err(|_| "gmail_unavailable")?
                .invalidate();
            return Ok(Value::Null);
        }
        _ => {}
    }
    let check_attachment_scope = || -> std::result::Result<(), String> {
        crate::resource_export_picker::context(&window, &scope)?;
        attachment::check_generation(&path, &scope, &account_id, cache_epoch)?;
        Ok(())
    };
    let download = if let Request::DownloadAttachment { id, part } = &request {
        if !api::valid_id(id) {
            return Err("gmail_invalid".into());
        }
        let body = store::cached(&path, &scope, &account_id, "body", id)?;
        let item = body["attachments"]
            .get(*part)
            .filter(|a| a["id"].as_u64() == Some(*part as u64))
            .cloned()
            .ok_or("mail_attachment_missing")?;
        let name = item["name"]
            .as_str()
            .ok_or("mail_attachment_missing")?
            .to_owned();
        let parent = window.clone();
        let target = tauri::async_runtime::spawn_blocking(move || {
            crate::mail_attachment::choose(&parent, &name)
        })
        .await
        .map_err(|_| "mail_attachment_save_failed")??;
        let Some(target) = target else {
            return Ok(json!({"saved":false}));
        };
        check_attachment_scope()?;
        Some((target, item))
    } else {
        None
    };
    if !crate::desktop_profile::system_credentials_enabled()
        && !matches!(request, Request::Disconnect { .. })
    {
        return Err("gmail_credentials_disabled".into());
    }
    let (generation, stop) = {
        let mut g = gate.state.lock().map_err(|_| "gmail_unavailable")?;
        if matches!(
            request,
            Request::Connect { .. } | Request::Disconnect { .. }
        ) {
            g.invalidate()
        }
        (g.generation, g.stop.clone())
    };
    let current = || -> Result<std::sync::MutexGuard<'_, Gate>> {
        let g = gate.state.lock().map_err(|_| "gmail_unavailable")?;
        if g.generation != generation {
            return Err("gmail_cancelled");
        }
        Ok(g)
    };
    if matches!(request, Request::Status) {
        return Ok(read_secret(&key)?
            .map(|s| perms(&s.scope))
            .unwrap_or(json!({"connected":false})));
    }
    // Token rotation and revocation are serialized per account. Cancel can still
    // invalidate an authorization while the browser or network is pending.
    let _network = tokio::select! {
        _ = stop.cancelled() => return Err("gmail_cancelled".into()),
        lock = gate.network.lock() => lock,
    };
    drop(current()?);
    let client = oauth::client()?;
    if let Request::Disconnect { clear_cache } = request {
        let previous = {
            let _g = current()?;
            let v = if crate::desktop_profile::system_credentials_enabled() {
                let saved = read_secret(&key)?;
                clear_secret(&key)?;
                saved
            } else {
                None
            };
            if clear_cache {
                store::clear_cache(&path, &scope, &account_id)?;
            }
            v
        };
        let revoked = match previous {
            Some(s) => client
                .post(REVOKE)
                .form(&[("token", s.refresh.as_str())])
                .send()
                .await
                .is_ok_and(|r| r.status().is_success()),
            None => true,
        };
        return Ok(json!({"connected":false,"revoked":revoked}));
    }
    let cfg = Config::load()?;
    if let Request::Connect { send } = request {
        let login = oauth::Login::bind().await?;
        let url = login.url(&cfg.id, &address, send)?;
        #[allow(deprecated)]
        window
            .shell()
            .open(url.to_string(), None)
            .map_err(|_| "gmail_browser_unavailable")?;
        let code = login.wait(&stop).await?;
        let mut tok = oauth::until_cancelled(
            &stop,
            oauth::tokens(
                &client,
                TOKEN,
                &cfg,
                &[
                    ("grant_type", "authorization_code"),
                    ("code", code.as_str()),
                    ("code_verifier", login.verifier.as_str()),
                    ("redirect_uri", login.redirect.as_str()),
                ],
            ),
        )
        .await?;
        let access = Zeroizing::new(std::mem::take(&mut tok.access_token));
        let requested = if send {
            format!("{READ} {SEND}")
        } else {
            READ.into()
        };
        let scope = consent_scope(
            &requested,
            tok.scope.as_deref().ok_or("gmail_permission_denied")?,
        );
        if !allowed(&scope, READ) {
            return Err("gmail_permission_denied".into());
        }
        let identity =
            oauth::until_cancelled(&stop, api::profile(&client, api::BASE, &access)).await?;
        if !identity.eq_ignore_ascii_case(&address) {
            return Err("gmail_account_mismatch".into());
        }
        let _guard = current()?;
        let refresh = tok
            .refresh_token
            .filter(|v| !v.is_empty())
            .ok_or("gmail_refresh_missing")?;
        save_secret(
            &key,
            &Saved {
                refresh,
                scope: scope.clone(),
                client_id: cfg.id,
            },
        )?;
        return Ok(perms(&scope));
    }
    let saved = {
        let _g = current()?;
        read_secret(&key)?.ok_or("gmail_reauthorize")?
    };
    let need = if matches!(request, Request::Send { .. }) {
        SEND
    } else {
        READ
    };
    if saved.client_id != cfg.id {
        return Err("gmail_reauthorize".into());
    }
    if !allowed(&saved.scope, need) {
        return Err("gmail_permission_denied".into());
    }
    if matches!(
        request,
        Request::Send {
            confirmed: false,
            ..
        }
    ) {
        return Err("gmail_confirmation_required".into());
    }
    if download.is_some() {
        check_attachment_scope()?;
    }
    let refreshed = oauth::until_cancelled(
        &stop,
        oauth::tokens(
            &client,
            TOKEN,
            &cfg,
            &[
                ("grant_type", "refresh_token"),
                ("refresh_token", &saved.refresh),
            ],
        ),
    )
    .await;
    let mut token = match refreshed {
        Ok(v) => v,
        Err("gmail_reauthorize") => {
            let _g = current()?;
            clear_secret(&key)?;
            return Err("gmail_reauthorize".into());
        }
        Err(e) => return Err(e.into()),
    };
    let token_scope = consent_scope(&saved.scope, token.scope.as_deref().unwrap_or(&saved.scope));
    let access = Zeroizing::new(std::mem::take(&mut token.access_token));
    {
        let _g = current()?;
        if let Some(updated) = updated_grant(&saved, token.refresh_token.take(), &token_scope) {
            save_secret(&key, &updated)?;
        }
    }
    // Record a reduced grant before reporting it, including when Google
    // keeps the refresh token unchanged. Status must not advertise lost rights.
    if !allowed(&token_scope, need) {
        return Err("gmail_permission_denied".into());
    }
    let response = match request {
        Request::Labels => {
            let labels = api::labels(&client, api::BASE, &access).await?;
            let _g = current()?;
            store::cache(&path, &scope, &account_id, cache_epoch, "labels", "", &labels)?;
            labels
        }
        Request::List { label, cursor, limit } => {
            let key = key_for(label.as_deref(), &cursor, limit)?;
            let label = label.as_deref().unwrap_or("INBOX");
            let folder = sync::CachedLabel {
                path: &path,
                scope: &scope,
                account: &account_id,
                label,
            };
            let snapshot =
                sync::fetch(&client, api::BASE, &access, folder, cursor.as_deref(), limit, &stop)
                    .await?;
            let _g = current()?;
            sync::apply(&path, &scope, &account_id, label, cache_epoch, &key, &snapshot)?;
            snapshot.page
        }
        Request::Read { id } => {
            let data = api::read(&client, api::BASE, &access, &id).await?;
            let _g = current()?;
            store::cache(&path, &scope, &account_id, cache_epoch, "body", &id, &data)?;
            data
        }
        Request::DownloadAttachment { id, part } => {
            let (target, item) = download.ok_or("mail_attachment_missing")?;
            let verify = || -> std::result::Result<_, String> {
                let guard = current()?;
                check_attachment_scope()?;
                Ok(guard)
            };
            attachment::save_confirmed(
                &target,
                verify,
                api::attachment(&client, api::BASE, &access, &id, part, &item),
            )
            .await?;
            json!({"saved":true})
        }
        Request::Send {
            draft_id,
            revision,
            confirmed: true,
        } => {
            let message = {
                let _g = current()?;
                store::begin(&path, &scope, &account_id, &address, &draft_id, revision)?
            };
            let (status, id) = api::send(&client, api::BASE, &access, &message.raw, message.thread.as_deref()).await;
            store::finish(
                &path,
                &scope,
                &account_id,
                &draft_id,
                revision,
                status,
                id.as_deref(),
            )?;
            json!({"status":status,"messageId":id})
        }
        _ => return Err("gmail_invalid".into()),
    };
    Ok(response)
}
