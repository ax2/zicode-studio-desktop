//! Trusted workspace IPC for the Alibaba mail adapter. Browser pages and Pi have no route to it.
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use studio_alibaba_mail::{Alibaba, Cursor, Mailbox};
use tauri::WebviewWindow;
use zeroize::Zeroizing;

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Request {
    ReplyDraft {
        account_id: String,
        uid_validity: u32,
        uid: u32,
    },
    CredentialStatus {
        account_id: String,
    },
    SetPassword {
        account_id: String,
        password: String,
    },
    ForgetPassword {
        account_id: String,
        #[serde(default)]
        clear_cache: bool,
    },
    Sync {
        account_id: String,
        cursor: Option<Cursor>,
        limit: u8,
    },
    CachedPage {
        account_id: String,
        cursor: Option<Cursor>,
        limit: u8,
    },
    Read {
        account_id: String,
        uid_validity: u32,
        uid: u32,
    },
    CachedBody {
        account_id: String,
        uid_validity: u32,
        uid: u32,
    },
    Send {
        account_id: String,
        draft_id: String,
        revision: u64,
        confirmed: bool,
        reply: Option<MessageRef>,
    },
    Delivery {
        account_id: String,
        draft_id: String,
        revision: u64,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MessageRef {
    uid_validity: u32,
    uid: u32,
}
impl Request {
    fn account(&self) -> &str {
        match self {
            Self::ReplyDraft { account_id, .. }
            | Self::CredentialStatus { account_id }
            | Self::SetPassword { account_id, .. }
            | Self::ForgetPassword { account_id, .. }
            | Self::Sync { account_id, .. }
            | Self::CachedPage { account_id, .. }
            | Self::Read { account_id, .. }
            | Self::CachedBody { account_id, .. }
            | Self::Send { account_id, .. }
            | Self::Delivery { account_id, .. } => account_id,
        }
    }
}
fn credential(scope: &str, account: &str) -> Result<keyring::Entry, String> {
    if !crate::desktop_profile::system_credentials_enabled() {
        return Err("mail_credentials_disabled".into());
    }
    let root = crate::app_paths::data_root()?
        .canonicalize()
        .map_err(|_| "mail_storage")?;
    let profile = root.to_string_lossy();
    #[cfg(windows)]
    let profile = profile.to_lowercase();
    let test = crate::desktop_profile::test_profile_name().unwrap_or("");
    let digest =
        Sha256::digest(format!("alibaba\0{profile}\0{test}\0{scope}\0{account}").as_bytes());
    keyring::Entry::new("ZiCode Studio Mail", &format!("mail-{digest:x}"))
        .map_err(|_| "mail_vault_unavailable".into())
}
fn password(scope: &str, account: &str) -> Result<Zeroizing<String>, String> {
    credential(scope, account)?
        .get_password()
        .map(Zeroizing::new)
        .map_err(|e| {
            match e {
                keyring::Error::NoEntry => "mail_password_missing",
                _ => "mail_vault_unavailable",
            }
            .into()
        })
}
#[tauri::command]
pub(crate) async fn mail_alibaba(
    window: WebviewWindow,
    workspace_id: String,
    request: Request,
) -> Result<Value, String> {
    crate::resource_export_picker::context(&window, &workspace_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::resource_export_picker::context(&window,&workspace_id)?;
        let root=crate::app_paths::data_root()?.canonicalize().map_err(|_|"mail_storage")?;
        let directory=root.join("mail");
        if directory.canonicalize().map_err(|_|"mail_storage")?!=directory{return Err("mail_storage".into())}
        let path=directory.join("mail.sqlite3");
        let mut db=Connection::open_with_flags(path,OpenFlags::SQLITE_OPEN_READ_WRITE|OpenFlags::SQLITE_OPEN_NOFOLLOW).map_err(|_|"mail_storage")?;
        db.busy_timeout(std::time::Duration::from_secs(3)).map_err(|_|"mail_storage")?;
        let id=request.account().to_owned();
        uuid::Uuid::parse_str(&id).map_err(|_|"mail_account_not_found")?;
        let mut mailbox=Mailbox::open(&mut db,&workspace_id,&id)?;
        let adapter=Alibaba::default();
        let vault=||credential(&workspace_id,&id);
        let pwd=||password(&workspace_id,&id);
        match request {
          Request::ReplyDraft{uid_validity,uid,..}=>Ok(mailbox.reply_draft(&uuid::Uuid::new_v4().to_string(),uid_validity,uid)?),
          Request::CredentialStatus{..}=>{
            if !crate::desktop_profile::system_credentials_enabled(){return Ok(json!({"configured":false,"enabled":false}))}
            let configured=match vault()?.get_password(){Ok(secret)=>!Zeroizing::new(secret).is_empty(),Err(keyring::Error::NoEntry)=>false,Err(_)=>return Err("mail_vault_unavailable".into())};
            Ok(json!({"configured":configured,"enabled":true}))
          }
          Request::SetPassword{password,..}=>{
            let value=Zeroizing::new(password);
            if value.is_empty()||value.len()>1024||value.contains(['\0','\r','\n']){return Err("mail_invalid_password".into())}
            vault()?.set_password(&value).map_err(|_|"mail_vault_unavailable")?;Ok(json!({"configured":true}))
          }
          Request::ForgetPassword{clear_cache,..}=>{
            if crate::desktop_profile::system_credentials_enabled(){
                match vault()?.delete_credential(){Ok(())|Err(keyring::Error::NoEntry)=>{},Err(_)=>return Err("mail_vault_unavailable".into())}
            }
            if clear_cache {mailbox.clear_cache()?}
            Ok(json!({"configured":false}))
          }
          Request::Sync{cursor,limit,..}=>Ok(json!(mailbox.sync(&adapter,pwd()?.as_str(),cursor,limit)?)),
          Request::CachedPage{cursor,limit,..}=>Ok(json!(mailbox.cached_page(cursor,limit)?)),
          Request::Read{uid_validity,uid,..}=>Ok(json!(mailbox.read(&adapter,pwd()?.as_str(),uid_validity,uid)?)),
          Request::CachedBody{uid_validity,uid,..}=>Ok(json!(mailbox.cached_body(uid_validity,uid)?)),
          Request::Send{draft_id,revision,confirmed,reply,..}=>{
              if !confirmed {return Err("mail_confirmation_required".into())}
              Ok(json!({"status":mailbox.send(&adapter,pwd()?.as_str(),&draft_id,revision,true,reply.map(|r|(r.uid_validity,r.uid)))?}))
          }
          Request::Delivery{draft_id,revision,..}=>Ok(json!({"status":mailbox.delivery(&draft_id,revision)?})),
        }
    }).await.map_err(|_|"mail_worker_failed")?
}
